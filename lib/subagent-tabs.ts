import type { AgentMessage, ToolResultMessage } from "./types";

// Types mirrored from pi's subagent tool (SubagentDetails / SingleResult).
// Live frames arrive via tool_execution_update partialResult.details; the
// final snapshot lands on the toolResult message's details.

export interface SubagentUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  contextTokens: number;
  turns: number;
}

export interface SubagentSingleResult {
  agent: string;
  task: string;
  step?: string;
  exitCode: number;
  messages: AgentMessage[];
  stderr: string;
  usage: SubagentUsage;
  model?: string;
  stopReason?: string;
  errorMessage?: string;
}

export interface SubagentDetails {
  mode: "single" | "parallel" | "chain";
  results: SubagentSingleResult[];
}

export type SubagentTabStatus = "running" | "done" | "error" | "aborted";

export interface SubagentTab {
  /** `toolCallId` for single mode, `toolCallId:index` for parallel/chain. */
  id: string;
  toolCallId: string;
  label: string;
  status: SubagentTabStatus;
  result: SubagentSingleResult | null;
}

export interface SubagentTaskParam {
  agent: string;
  task: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

const EMPTY_USAGE: SubagentUsage = {
  input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0,
};

function normalizeUsage(value: unknown): SubagentUsage {
  if (!isRecord(value)) return { ...EMPTY_USAGE };
  const num = (key: keyof SubagentUsage) => (typeof value[key] === "number" ? (value[key] as number) : 0);
  return {
    input: num("input"),
    output: num("output"),
    cacheRead: num("cacheRead"),
    cacheWrite: num("cacheWrite"),
    cost: num("cost"),
    contextTokens: num("contextTokens"),
    turns: num("turns"),
  };
}

function normalizeSingleResult(value: unknown): SubagentSingleResult | null {
  if (!isRecord(value)) return null;
  return {
    agent: asString(value.agent) ?? "subagent",
    task: asString(value.task) ?? asString(value.step) ?? "",
    step: asString(value.step),
    exitCode: typeof value.exitCode === "number" ? value.exitCode : -1,
    messages: Array.isArray(value.messages) ? (value.messages as AgentMessage[]) : [],
    stderr: asString(value.stderr) ?? "",
    usage: normalizeUsage(value.usage),
    model: asString(value.model),
    stopReason: asString(value.stopReason),
    errorMessage: asString(value.errorMessage),
  };
}

/**
 * 宽松解析 SubagentDetails；运行中的部分帧字段可能不全，一律给默认值。
 * @param value 待解析的 details 数据
 * @returns 结构化结果，形状不符时返回 null
 */
export function normalizeSubagentDetails(value: unknown): SubagentDetails | null {
  if (!isRecord(value)) return null;
  const { mode } = value;
  if (mode !== "single" && mode !== "parallel" && mode !== "chain") return null;
  if (!Array.isArray(value.results)) return null;
  const results = value.results
    .map(normalizeSingleResult)
    .filter((r): r is SubagentSingleResult => r !== null);
  return { mode, results };
}

export interface SubagentParams {
  /** true when the tool input used the `tasks` array form (parallel/chain). */
  isMulti: boolean;
  tasks: SubagentTaskParam[];
}

function normalizeTaskParam(value: unknown): SubagentTaskParam | null {
  if (!isRecord(value)) return null;
  return {
    agent: asString(value.agent) ?? "subagent",
    task: asString(value.task) ?? asString(value.step) ?? "",
  };
}

/** 从 subagent 工具调用的 input/arguments 中读取任务参数。 */
export function readSubagentParams(input: unknown): SubagentParams {
  if (!isRecord(input)) return { isMulti: false, tasks: [] };
  if (Array.isArray(input.tasks)) {
    return {
      isMulti: true,
      tasks: input.tasks
        .map(normalizeTaskParam)
        .filter((task): task is SubagentTaskParam => task !== null),
    };
  }
  return {
    isMulti: false,
    tasks: [{
      agent: asString(input.agent) ?? "subagent",
      task: asString(input.task) ?? "",
    }],
  };
}

export const SUBAGENT_TOOL_NAME = "subagent";

function isSubagentToolCallBlock(block: unknown): block is Record<string, unknown> {
  if (!isRecord(block) || block.type !== "toolCall") return false;
  const name = asString(block.toolName) ?? asString(block.name) ?? "";
  return name === SUBAGENT_TOOL_NAME;
}

/** 默认标签名：agent名-任务前12字。 */
export function defaultSubagentLabel(agent: string, task: string): string {
  const trimmed = task.replace(/\s+/g, " ").trim();
  if (!trimmed) return agent;
  const preview = trimmed.length > 12 ? `${trimmed.slice(0, 12).trimEnd()}…` : trimmed;
  return `${agent}-${preview}`;
}

function makeTab(
  id: string,
  toolCallId: string,
  result: SubagentSingleResult | null,
  param: SubagentTaskParam | undefined,
): SubagentTab {
  const agent = result?.agent ?? param?.agent ?? "subagent";
  const task = result?.task ?? param?.task ?? "";
  let status: SubagentTabStatus = "running";
  if (result && result.exitCode !== -1) {
    status = result.exitCode === 0 && !result.errorMessage ? "done" : "error";
  }
  return { id, toolCallId, label: defaultSubagentLabel(agent, task), status, result };
}

function tabsForCall(
  toolCallId: string,
  params: SubagentParams,
  details: SubagentDetails | null,
): SubagentTab[] {
  if (details) {
    if (details.mode === "single") {
      return [makeTab(toolCallId, toolCallId, details.results[0] ?? null, params.tasks[0])];
    }
    return details.results.map((result, index) => makeTab(
      `${toolCallId}:${index}`,
      toolCallId,
      result,
      params.tasks[index],
    ));
  }
  if (params.isMulti) {
    return params.tasks.map((task, index) => makeTab(`${toolCallId}:${index}`, toolCallId, null, task));
  }
  return [makeTab(toolCallId, toolCallId, null, params.tasks[0])];
}

/**
 * 从主会话 messages 与实时 details 合并出子 agent 标签列表。
 * toolCall 有最终 toolResult 时以其 details 为准，否则用实时帧，
 * 再否则按工具调用参数生成「运行中」占位标签。
 * @param messages 主会话消息
 * @param liveDetails 运行中 toolCallId → 最新 SubagentDetails
 * @returns 按消息出现顺序排列的标签
 */
export function buildSubagentTabs(
  messages: AgentMessage[],
  liveDetails: ReadonlyMap<string, SubagentDetails>,
): SubagentTab[] {
  const toolResults = new Map<string, ToolResultMessage>();
  for (const msg of messages) {
    if (msg.role === "toolResult") toolResults.set((msg as ToolResultMessage).toolCallId, msg as ToolResultMessage);
  }

  const tabs: SubagentTab[] = [];
  const seen = new Set<string>();
  for (const msg of messages) {
    if (msg.role !== "assistant" || !Array.isArray(msg.content)) continue;
    for (const block of msg.content) {
      if (!isSubagentToolCallBlock(block)) continue;
      const toolCallId = asString(block.toolCallId) ?? asString(block.id) ?? "";
      if (!toolCallId || seen.has(toolCallId)) continue;
      seen.add(toolCallId);
      const input = isRecord(block.input) ? block.input : (isRecord(block.arguments) ? block.arguments : null);
      const params = readSubagentParams(input);
      const details = normalizeSubagentDetails(toolResults.get(toolCallId)?.details)
        ?? liveDetails.get(toolCallId)
        ?? null;
      tabs.push(...tabsForCall(toolCallId, params, details));
    }
  }
  return tabs;
}
