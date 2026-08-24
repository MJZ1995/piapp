import assert from "node:assert/strict";
import test from "node:test";

const {
  buildSubagentTabs,
  defaultSubagentLabel,
  normalizeSubagentDetails,
  readSubagentParams,
} = await import("./subagent-tabs.ts");

function usage(overrides = {}) {
  return { input: 10, output: 20, cacheRead: 0, cacheWrite: 0, cost: 0.01, contextTokens: 30, turns: 2, ...overrides };
}

function singleResult(overrides = {}) {
  return {
    agent: "scout",
    task: "look at the repo structure",
    exitCode: 0,
    messages: [],
    stderr: "",
    usage: usage(),
    ...overrides,
  };
}

function subagentToolCall(toolCallId, input, raw = false) {
  const block = raw
    ? { type: "toolCall", id: toolCallId, name: "subagent", arguments: input }
    : { type: "toolCall", toolCallId, toolName: "subagent", input };
  return { role: "assistant", provider: "p", model: "m", content: [block] };
}

function toolResultMessage(toolCallId, details) {
  return {
    role: "toolResult",
    toolCallId,
    content: [{ type: "text", text: "done" }],
    details,
  };
}

test("normalizeSubagentDetails accepts valid details and fills defaults", () => {
  const details = normalizeSubagentDetails({ mode: "parallel", results: [{ agent: "a" }] });
  assert.equal(details.mode, "parallel");
  assert.equal(details.results.length, 1);
  assert.equal(details.results[0].agent, "a");
  assert.equal(details.results[0].exitCode, -1);
  assert.deepEqual(details.results[0].messages, []);
  assert.equal(details.results[0].usage.turns, 0);
});

test("normalizeSubagentDetails rejects bad shapes", () => {
  assert.equal(normalizeSubagentDetails(null), null);
  assert.equal(normalizeSubagentDetails({ mode: "weird", results: [] }), null);
  assert.equal(normalizeSubagentDetails({ mode: "single" }), null);
  assert.equal(normalizeSubagentDetails("x"), null);
});

test("readSubagentParams parses single and tasks forms", () => {
  const single = readSubagentParams({ agent: "scout", task: "do it" });
  assert.equal(single.isMulti, false);
  assert.deepEqual(single.tasks, [{ agent: "scout", task: "do it" }]);

  const multi = readSubagentParams({ tasks: [{ agent: "a", task: "t1" }, { agent: "b", task: "t2" }] });
  assert.equal(multi.isMulti, true);
  assert.equal(multi.tasks.length, 2);

  assert.deepEqual(readSubagentParams(null), { isMulti: false, tasks: [] });
});

test("defaultSubagentLabel truncates the task to 12 chars", () => {
  assert.equal(defaultSubagentLabel("scout", "short"), "scout-short");
  assert.equal(defaultSubagentLabel("scout", "a".repeat(20)), `scout-${"a".repeat(12)}…`);
  assert.equal(defaultSubagentLabel("scout", ""), "scout");
});

test("buildSubagentTabs creates a running tab from a bare toolCall", () => {
  const messages = [subagentToolCall("call-1", { agent: "scout", task: "explore the repo" })];
  const tabs = buildSubagentTabs(messages, new Map());
  assert.equal(tabs.length, 1);
  assert.equal(tabs[0].id, "call-1");
  assert.equal(tabs[0].toolCallId, "call-1");
  assert.equal(tabs[0].status, "running");
  assert.equal(tabs[0].label, "scout-explore the…");
  assert.equal(tabs[0].result, null);
});

test("buildSubagentTabs supports raw name/arguments blocks from session files", () => {
  const messages = [subagentToolCall("call-raw", { agent: "dev", task: "fix" }, true)];
  const tabs = buildSubagentTabs(messages, new Map());
  assert.equal(tabs.length, 1);
  assert.equal(tabs[0].label, "dev-fix");
});

test("buildSubagentTabs ignores non-subagent tool calls", () => {
  const messages = [{
    role: "assistant", provider: "p", model: "m",
    content: [{ type: "toolCall", toolCallId: "c1", toolName: "read", input: { path: "/x" } }],
  }];
  assert.deepEqual(buildSubagentTabs(messages, new Map()), []);
});

test("buildSubagentTabs prefers final toolResult details and maps statuses", () => {
  const details = {
    mode: "parallel",
    results: [
      singleResult({ agent: "a", task: "t1", exitCode: 0 }),
      singleResult({ agent: "b", task: "t2", exitCode: 1 }),
      singleResult({ agent: "c", task: "t3", exitCode: -1 }),
    ],
  };
  const live = new Map([["call-2", { mode: "parallel", results: [singleResult()] }]]);
  const messages = [
    subagentToolCall("call-2", { tasks: [{ agent: "a", task: "t1" }, { agent: "b", task: "t2" }, { agent: "c", task: "t3" }] }),
    toolResultMessage("call-2", details),
  ];
  const tabs = buildSubagentTabs(messages, live);
  assert.equal(tabs.length, 3);
  assert.deepEqual(tabs.map((tab) => tab.id), ["call-2:0", "call-2:1", "call-2:2"]);
  assert.deepEqual(tabs.map((tab) => tab.status), ["done", "error", "running"]);
  assert.deepEqual(tabs.map((tab) => tab.toolCallId), ["call-2", "call-2", "call-2"]);
  assert.equal(tabs[0].result.agent, "a");
});

test("buildSubagentTabs uses live details while running", () => {
  const liveDetails = new Map([["call-3", normalizeSubagentDetails({
    mode: "parallel",
    results: [singleResult({ exitCode: -1 }), singleResult({ exitCode: 0 })],
  })]]);
  const messages = [subagentToolCall("call-3", { tasks: [{ agent: "a", task: "x" }, { agent: "b", task: "y" }] })];
  const tabs = buildSubagentTabs(messages, liveDetails);
  assert.equal(tabs.length, 2);
  assert.deepEqual(tabs.map((tab) => tab.status), ["running", "done"]);
});

test("buildSubagentTabs creates per-step tabs for chain mode", () => {
  const messages = [
    subagentToolCall("call-4", { tasks: [{ agent: "a", task: "step one" }] }),
    toolResultMessage("call-4", {
      mode: "chain",
      results: [
        singleResult({ agent: "a", task: "step one", exitCode: 0 }),
        singleResult({ agent: "b", task: "step two", exitCode: 0 }),
      ],
    }),
  ];
  const tabs = buildSubagentTabs(messages, new Map());
  assert.deepEqual(tabs.map((tab) => tab.id), ["call-4:0", "call-4:1"]);
  assert.equal(tabs[1].label, "b-step two");
});

test("buildSubagentTabs treats errorMessage as failure and dedupes toolCallIds", () => {
  const messages = [
    subagentToolCall("call-5", { agent: "a", task: "x" }),
    subagentToolCall("call-5", { agent: "a", task: "x" }),
    toolResultMessage("call-5", { mode: "single", results: [singleResult({ exitCode: 0, errorMessage: "boom" })] }),
  ];
  const tabs = buildSubagentTabs(messages, new Map());
  assert.equal(tabs.length, 1);
  assert.equal(tabs[0].status, "error");
});
