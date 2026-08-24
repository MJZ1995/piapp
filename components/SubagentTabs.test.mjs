import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { SubagentTabBar } = await jiti.import("./SubagentTabBar.tsx");
const { SubagentView } = await jiti.import("./SubagentView.tsx");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");

function usage(overrides = {}) {
  return { input: 1234, output: 567, cacheRead: 0, cacheWrite: 0, cost: 0.0123, contextTokens: 1800, turns: 3, ...overrides };
}

function makeTab(overrides = {}) {
  return {
    id: "call-1",
    toolCallId: "call-1",
    label: "scout-explore the…",
    status: "done",
    result: {
      agent: "scout",
      task: "explore the repo",
      exitCode: 0,
      messages: [],
      stderr: "",
      usage: usage(),
      model: "gpt-5",
    },
    ...overrides,
  };
}

function renderWithI18n(element) {
  return renderToStaticMarkup(React.createElement(I18nProvider, null, element));
}

test("tab bar renders the main tab first, then one tab per subagent task", () => {
  const html = renderWithI18n(
    React.createElement(SubagentTabBar, {
      tabs: [
        makeTab(),
        makeTab({ id: "call-2:0", toolCallId: "call-2", label: "dev-fix bug", status: "running", result: null }),
        makeTab({ id: "call-2:1", toolCallId: "call-2", label: "ops-deploy", status: "error" }),
      ],
      activeId: null,
      renamedLabels: {},
      onSelect: () => {},
      onClose: () => {},
      onRename: () => {},
    }),
  );
  assert.match(html, /Main/);
  assert.match(html, /scout-explore the…/);
  assert.match(html, /dev-fix bug/);
  assert.match(html, /ops-deploy/);
  // 状态图标：完成 ✓、运行中 ⏳、失败 ✗
  assert.match(html, /✓/);
  assert.match(html, /⏳/);
  assert.match(html, /✗/);
});

test("tab bar applies renamed labels", () => {
  const html = renderWithI18n(
    React.createElement(SubagentTabBar, {
      tabs: [makeTab()],
      activeId: "call-1",
      renamedLabels: { "call-1": "仓库结构调研" },
      onSelect: () => {},
      onClose: () => {},
      onRename: () => {},
    }),
  );
  assert.match(html, /仓库结构调研/);
  assert.doesNotMatch(html, /scout-explore/);
});

test("subagent view renders assistant markdown, compact tool calls and the usage footer", () => {
  const tab = makeTab({
    result: {
      agent: "scout",
      task: "explore",
      exitCode: 0,
      messages: [
        { role: "user", content: "explore the repo" },
        {
          role: "assistant", provider: "p", model: "m",
          content: [
            { type: "text", text: "Found **three** packages." },
            { type: "toolCall", id: "t1", name: "read", arguments: { path: "/repo/package.json" } },
          ],
        },
      ],
      stderr: "",
      usage: usage(),
      model: "gpt-5",
    },
  });
  const html = renderWithI18n(
    React.createElement(SubagentView, { tab, label: "scout-explore" }),
  );
  assert.match(html, /explore the repo/);
  assert.match(html, /<strong>three<\/strong>/);
  assert.match(html, /→ /);
  assert.match(html, /read/);
  assert.match(html, /\/repo\/package\.json/);
  assert.match(html, /3 turns/);
  assert.match(html, /1,234 in/);
  assert.match(html, /567 out/);
  assert.match(html, /\$0\.0123/);
  assert.match(html, /gpt-5/);
});

test("subagent view shows the empty placeholder for a running tab without output", () => {
  const html = renderWithI18n(
    React.createElement(SubagentView, {
      tab: makeTab({ status: "running", result: null }),
      label: "scout-explore",
    }),
  );
  assert.match(html, /No output yet/);
});
