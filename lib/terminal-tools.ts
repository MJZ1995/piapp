import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { resolveTerminalContext } from "./terminal-access";
import {
  activateTerminal,
  closeTerminal,
  createTerminal,
  hasTerminalChildProcess,
  isHighRiskShellInput,
  listTerminals,
  readTerminal,
  renameTerminal,
  resolveTerminal,
  terminalKeyData,
  wasRecentlyUsed,
  writeTerminal,
} from "./terminal-manager";

function textResult(text: string, details: Record<string, unknown> = {}) {
  return { content: [{ type: "text" as const, text }], details };
}

function terminalListText(projectKey: string): string {
  const terminals = listTerminals(projectKey);
  if (terminals.length === 0) return "No terminal is open for this project.";
  return terminals.map((terminal) => [
    terminal.active ? "*" : "-",
    terminal.name,
    terminal.running ? "running" : `exited (${terminal.exitCode ?? "unknown"})`,
    terminal.trusted ? "trusted" : "protected",
    terminal.focused ? "user-focused" : "not-focused",
    terminal.id,
  ].join(" · ")).join("\n");
}

export function createTerminalTools(): ToolDefinition[] {
  const manage = defineTool({
    name: "terminal_manage",
    label: "Terminal Manage",
    description: "List project terminals, or create, rename, and close a terminal. Create or close only when the user explicitly asks.",
    promptSnippet: "Manage Yasuo Agent's persistent project terminals.",
    promptGuidelines: [
      "Use terminal_manage list before targeting a terminal when its name is unclear.",
      "Create or close terminals only when the user explicitly requests it.",
    ],
    executionMode: "sequential",
    parameters: Type.Object({
      action: Type.Union([
        Type.Literal("list"),
        Type.Literal("create"),
        Type.Literal("rename"),
        Type.Literal("close"),
      ]),
      target: Type.Optional(Type.String({ description: "Terminal name or id; omit to use the active terminal" })),
      name: Type.Optional(Type.String({ description: "Name for create or rename" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const context = await resolveTerminalContext(ctx.cwd);
      if (params.action === "list") return textResult(terminalListText(context.projectKey));
      if (params.action === "create") {
        const terminal = createTerminal({ cwd: context.cwd, projectKey: context.projectKey, name: params.name });
        return textResult(`Created ${terminal.name} in ${terminal.cwd}.`, { terminal });
      }

      const terminal = resolveTerminal(context.projectKey, params.target);
      if (params.action === "rename") {
        if (!params.name) throw new Error("A new terminal name is required");
        const renamed = renameTerminal(terminal.id, params.name);
        return textResult(`Renamed terminal to ${renamed.name}.`, { terminal: renamed });
      }

      if (hasTerminalChildProcess(terminal.id)) {
        const confirmed = await ctx.ui.confirm(
          "关闭运行中的终端？ / Close running terminal?",
          `“${terminal.name}”仍有程序在运行。是否终止该程序并关闭终端？`,
        );
        if (!confirmed) return textResult(`Close cancelled for ${terminal.name}.`, { cancelled: true });
      }
      closeTerminal(terminal.id);
      return textResult(`Closed ${terminal.name}.`);
    },
  });

  const read = defineTool({
    name: "terminal_read",
    label: "Terminal Read",
    description: "Read the visible screen and recent output from a persistent Yasuo Agent terminal.",
    promptSnippet: "Read the current screen and recent output of a project terminal.",
    executionMode: "sequential",
    parameters: Type.Object({
      target: Type.Optional(Type.String({ description: "Terminal name or id; omit to use the active terminal" })),
      lines: Type.Optional(Type.Number({ minimum: 1, maximum: 1000, description: "Recent lines to read; defaults to 200" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const context = await resolveTerminalContext(ctx.cwd);
      const terminal = resolveTerminal(context.projectKey, params.target);
      const output = readTerminal(terminal.id, params.lines ?? 200);
      return textResult(
        `Terminal: ${terminal.name}\nStatus: ${terminal.running ? "running" : `exited (${terminal.exitCode ?? "unknown"})`}\n\n${output || "(screen is empty)"}`,
        { terminalId: terminal.id, terminalName: terminal.name, lines: params.lines ?? 200 },
      );
    },
  });

  const write = defineTool({
    name: "terminal_write",
    label: "Terminal Write",
    description: "Send text or a supported key to a persistent terminal. Use kind=shell at a shell prompt and kind=interactive inside AGY, OpenCode, Kimi, or another TUI.",
    promptSnippet: "Send text, Enter, or a control key to a project terminal.",
    promptGuidelines: [
      "Read a terminal before writing when its current prompt or running program is uncertain.",
      "Use kind=interactive for input to a running TUI and kind=shell only for shell commands.",
      "Do not claim a terminal action succeeded until terminal_read shows the resulting state.",
    ],
    executionMode: "sequential",
    parameters: Type.Object({
      target: Type.Optional(Type.String({ description: "Terminal name or id; omit to use the active terminal" })),
      kind: Type.Union([Type.Literal("shell"), Type.Literal("interactive")]),
      text: Type.Optional(Type.String({ description: "Text to type" })),
      key: Type.Optional(Type.Union([
        Type.Literal("enter"),
        Type.Literal("escape"),
        Type.Literal("tab"),
        Type.Literal("ctrl-c"),
        Type.Literal("ctrl-d"),
        Type.Literal("up"),
        Type.Literal("down"),
        Type.Literal("right"),
        Type.Literal("left"),
      ])),
      submit: Type.Optional(Type.Boolean({ description: "Append Enter after text; defaults to true when text is provided" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const context = await resolveTerminalContext(ctx.cwd);
      const terminal = resolveTerminal(context.projectKey, params.target);
      if (!params.text && !params.key) throw new Error("Terminal text or key is required");

      const submit = params.submit ?? Boolean(params.text);
      const input = `${params.text ?? ""}${params.key ? terminalKeyData(params.key) : ""}${submit && params.key !== "enter" ? "\r" : ""}`;
      const reasons = [
        wasRecentlyUsed(terminal.id) ? "you are currently using this terminal" : null,
        !terminal.trusted && params.kind === "interactive" ? "interactive CLI input requires confirmation in protected mode" : null,
        !terminal.trusted && params.kind === "shell" && isHighRiskShellInput(params.text ?? "") ? "the shell command may be destructive" : null,
      ].filter(Boolean);

      if (reasons.length > 0) {
        const preview = (params.text || params.key || "").slice(0, 500);
        const confirmed = await ctx.ui.confirm(
          `发送到 ${terminal.name}？ / Send to terminal?`,
          `${reasons.join("; ")}\n\n待发送内容：\n${preview}`,
        );
        if (!confirmed) return textResult(`Send cancelled for ${terminal.name}.`, { cancelled: true });
      }

      writeTerminal(terminal.id, input, "agent");
      activateTerminal(terminal.id);
      return textResult(`Sent input to ${terminal.name}.`, {
        terminalId: terminal.id,
        terminalName: terminal.name,
        kind: params.kind,
        confirmed: reasons.length > 0,
      });
    },
  });

  return [manage, read, write];
}
