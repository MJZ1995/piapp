import { execFileSync } from "child_process";
import { randomUUID } from "crypto";
import os from "os";
import path from "path";
import * as pty from "node-pty";
import { Terminal as HeadlessTerminal } from "@xterm/headless";
import { SerializeAddon } from "@xterm/addon-serialize";

const DEFAULT_COLS = 100;
const DEFAULT_ROWS = 28;
const SCROLLBACK_LINES = 10_000;

export type TerminalEvent =
  | { type: "data"; data: string }
  | { type: "exit"; exitCode: number; signal?: number }
  | { type: "meta"; terminal: TerminalInfo };

export interface TerminalInfo {
  id: string;
  name: string;
  cwd: string;
  projectKey: string;
  shell: string;
  createdAt: number;
  running: boolean;
  exitCode: number | null;
  trusted: boolean;
  focused: boolean;
  active: boolean;
}

type TerminalListener = (event: TerminalEvent) => void;

type ManagedTerminal = {
  id: string;
  name: string;
  cwd: string;
  projectKey: string;
  shell: string;
  createdAt: number;
  running: boolean;
  exitCode: number | null;
  trusted: boolean;
  focused: boolean;
  lastUserInputAt: number;
  process: pty.IPty;
  screen: HeadlessTerminal;
  serializer: SerializeAddon;
  listeners: Set<TerminalListener>;
};

type TerminalState = {
  sessions: Map<string, ManagedTerminal>;
  activeByProject: Map<string, string>;
  cleanupRegistered: boolean;
};

declare global {
  var __yasuoTerminalState: TerminalState | undefined;
}

function state(): TerminalState {
  if (!globalThis.__yasuoTerminalState) {
    globalThis.__yasuoTerminalState = {
      sessions: new Map(),
      activeByProject: new Map(),
      cleanupRegistered: false,
    };
  }
  const current = globalThis.__yasuoTerminalState;
  if (!current.cleanupRegistered) {
    current.cleanupRegistered = true;
    const cleanup = () => {
      for (const terminal of current.sessions.values()) {
        try { terminal.process.kill(); } catch { /* already exited */ }
        terminal.screen.dispose();
      }
      current.sessions.clear();
      current.activeByProject.clear();
    };
    process.once("exit", cleanup);
    process.once("SIGINT", cleanup);
    process.once("SIGTERM", cleanup);
  }
  return current;
}

function clampSize(value: number | undefined, fallback: number, max: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(2, Math.min(max, Math.floor(value!)));
}

function nextName(projectKey: string): string {
  const names = new Set(listTerminals(projectKey).map((terminal) => terminal.name.toLowerCase()));
  for (let index = 1; ; index += 1) {
    const candidate = `Terminal ${index}`;
    if (!names.has(candidate.toLowerCase())) return candidate;
  }
}

function assertUniqueName(projectKey: string, name: string, exceptId?: string): string {
  const normalized = name.trim();
  if (!normalized) throw new Error("Terminal name is required");
  if (normalized.length > 64) throw new Error("Terminal name is too long");
  if (listTerminals(projectKey).some((terminal) => terminal.id !== exceptId && terminal.name.toLowerCase() === normalized.toLowerCase())) {
    throw new Error(`Terminal name already exists: ${normalized}`);
  }
  return normalized;
}

function info(terminal: ManagedTerminal): TerminalInfo {
  return {
    id: terminal.id,
    name: terminal.name,
    cwd: terminal.cwd,
    projectKey: terminal.projectKey,
    shell: terminal.shell,
    createdAt: terminal.createdAt,
    running: terminal.running,
    exitCode: terminal.exitCode,
    trusted: terminal.trusted,
    focused: terminal.focused,
    active: state().activeByProject.get(terminal.projectKey) === terminal.id,
  };
}

function emit(terminal: ManagedTerminal, event: TerminalEvent): void {
  for (const listener of terminal.listeners) {
    try { listener(event); } catch { /* listener disconnected */ }
  }
}

export function terminalsEnabled(): boolean {
  return process.platform === "darwin" && process.env.PI_WEB_DESKTOP === "1";
}

export function createTerminal(options: {
  cwd: string;
  projectKey: string;
  name?: string;
  cols?: number;
  rows?: number;
}): TerminalInfo {
  if (!terminalsEnabled()) throw new Error("Terminal is available only in Yasuo Agent desktop mode");

  const cwd = path.resolve(options.cwd);
  const projectKey = path.resolve(options.projectKey);
  const name = assertUniqueName(projectKey, options.name ?? nextName(projectKey));
  const cols = clampSize(options.cols, DEFAULT_COLS, 500);
  const rows = clampSize(options.rows, DEFAULT_ROWS, 200);
  const shell = process.env.SHELL || os.userInfo().shell || "/bin/zsh";
  const screen = new HeadlessTerminal({ cols, rows, scrollback: SCROLLBACK_LINES, allowProposedApi: true });
  const serializer = new SerializeAddon();
  screen.loadAddon(serializer as unknown as Parameters<HeadlessTerminal["loadAddon"]>[0]);

  const processHandle = pty.spawn(shell, ["-l"], {
    name: "xterm-256color",
    cols,
    rows,
    cwd,
    env: {
      ...process.env,
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
    },
  });

  const terminal: ManagedTerminal = {
    id: randomUUID(),
    name,
    cwd,
    projectKey,
    shell,
    createdAt: Date.now(),
    running: true,
    exitCode: null,
    trusted: false,
    focused: false,
    lastUserInputAt: 0,
    process: processHandle,
    screen,
    serializer,
    listeners: new Set(),
  };

  state().sessions.set(terminal.id, terminal);
  state().activeByProject.set(projectKey, terminal.id);

  processHandle.onData((data) => {
    terminal.screen.write(data);
    emit(terminal, { type: "data", data });
  });
  processHandle.onExit(({ exitCode, signal }) => {
    terminal.running = false;
    terminal.exitCode = exitCode;
    terminal.trusted = false;
    terminal.focused = false;
    emit(terminal, { type: "exit", exitCode, signal });
    emit(terminal, { type: "meta", terminal: info(terminal) });
  });

  return info(terminal);
}

export function listTerminals(projectKey: string): TerminalInfo[] {
  const normalizedProject = path.resolve(projectKey);
  return [...state().sessions.values()]
    .filter((terminal) => terminal.projectKey === normalizedProject)
    .sort((left, right) => left.createdAt - right.createdAt)
    .map(info);
}

export function getTerminal(id: string): TerminalInfo | null {
  const terminal = state().sessions.get(id);
  return terminal ? info(terminal) : null;
}

export function resolveTerminal(projectKey: string, target?: string): TerminalInfo {
  const terminals = listTerminals(projectKey);
  if (terminals.length === 0) throw new Error("No terminal is open for this project");

  const normalizedTarget = target?.trim().toLowerCase();
  const terminal = normalizedTarget
    ? terminals.find((candidate) => candidate.id === target || candidate.name.toLowerCase() === normalizedTarget)
    : terminals.find((candidate) => candidate.active) ?? terminals[0];
  if (!terminal) throw new Error(`Terminal not found: ${target}`);
  return terminal;
}

export function activateTerminal(id: string): TerminalInfo {
  const terminal = requireTerminal(id);
  state().activeByProject.set(terminal.projectKey, terminal.id);
  emit(terminal, { type: "meta", terminal: info(terminal) });
  return info(terminal);
}

export function renameTerminal(id: string, name: string): TerminalInfo {
  const terminal = requireTerminal(id);
  terminal.name = assertUniqueName(terminal.projectKey, name, id);
  emit(terminal, { type: "meta", terminal: info(terminal) });
  return info(terminal);
}

export function setTerminalTrusted(id: string, trusted: boolean): TerminalInfo {
  const terminal = requireTerminal(id);
  terminal.trusted = terminal.running && trusted;
  emit(terminal, { type: "meta", terminal: info(terminal) });
  return info(terminal);
}

export function setTerminalFocused(id: string, focused: boolean): TerminalInfo {
  const terminal = requireTerminal(id);
  terminal.focused = focused;
  emit(terminal, { type: "meta", terminal: info(terminal) });
  return info(terminal);
}

export function wasRecentlyUsed(id: string, withinMs = 1500): boolean {
  const terminal = requireTerminal(id);
  return terminal.focused || Date.now() - terminal.lastUserInputAt < withinMs;
}

export function writeTerminal(id: string, data: string, source: "user" | "agent" = "user"): void {
  const terminal = requireTerminal(id);
  if (!terminal.running) throw new Error(`Terminal has exited: ${terminal.name}`);
  if (!data || data.length > 64 * 1024) throw new Error("Terminal input must be between 1 byte and 64 KiB");
  if (source === "user") terminal.lastUserInputAt = Date.now();
  terminal.process.write(data);
}

export function resizeTerminal(id: string, cols: number, rows: number): TerminalInfo {
  const terminal = requireTerminal(id);
  const safeCols = clampSize(cols, DEFAULT_COLS, 500);
  const safeRows = clampSize(rows, DEFAULT_ROWS, 200);
  terminal.process.resize(safeCols, safeRows);
  terminal.screen.resize(safeCols, safeRows);
  return info(terminal);
}

export function readTerminal(id: string, requestedLines = 200): string {
  const terminal = requireTerminal(id);
  const lines = clampSize(requestedLines, 200, 1000);
  const buffer = terminal.screen.buffer.active;
  const start = Math.max(0, buffer.length - Math.max(lines, terminal.screen.rows));
  const result: string[] = [];
  for (let index = start; index < buffer.length; index += 1) {
    result.push(buffer.getLine(index)?.translateToString(true) ?? "");
  }
  while (result.length > 0 && result[result.length - 1] === "") result.pop();
  return result.join("\n");
}

export function terminalSnapshot(id: string): string {
  return requireTerminal(id).serializer.serialize({ scrollback: SCROLLBACK_LINES });
}

export function subscribeTerminal(id: string, listener: TerminalListener): () => void {
  const terminal = requireTerminal(id);
  terminal.listeners.add(listener);
  return () => terminal.listeners.delete(listener);
}

export function hasTerminalChildProcess(id: string): boolean {
  const terminal = requireTerminal(id);
  if (!terminal.running) return false;
  try {
    const output = execFileSync("/bin/ps", ["-axo", "pid=,ppid="], { encoding: "utf8", timeout: 2000 });
    const children = new Map<number, number[]>();
    for (const line of output.split("\n")) {
      const match = line.trim().match(/^(\d+)\s+(\d+)$/);
      if (!match) continue;
      const pid = Number(match[1]);
      const parent = Number(match[2]);
      const siblings = children.get(parent) ?? [];
      siblings.push(pid);
      children.set(parent, siblings);
    }
    const queue = [terminal.process.pid];
    const seen = new Set(queue);
    while (queue.length > 0) {
      const parent = queue.shift()!;
      for (const child of children.get(parent) ?? []) {
        if (seen.has(child)) continue;
        return true;
      }
    }
  } catch {
    // If process inspection fails, confirm before closing rather than guessing.
    return true;
  }
  return false;
}

export function closeTerminal(id: string): void {
  const terminal = requireTerminal(id);
  state().sessions.delete(id);
  terminal.listeners.clear();
  terminal.trusted = false;
  terminal.focused = false;
  try { if (terminal.running) terminal.process.kill(); } catch { /* already exited */ }
  terminal.screen.dispose();

  if (state().activeByProject.get(terminal.projectKey) === id) {
    const next = listTerminals(terminal.projectKey).at(-1);
    if (next) state().activeByProject.set(terminal.projectKey, next.id);
    else state().activeByProject.delete(terminal.projectKey);
  }
}

export function parseTerminalCommand(projectKey: string, rawArgs: string): { terminal: TerminalInfo; input: string } {
  const args = rawArgs.trim();
  if (!args) throw new Error("Usage: /terminal [terminal name] <input>");
  const terminals = listTerminals(projectKey).sort((left, right) => right.name.length - left.name.length);
  const named = terminals.find((candidate) => (
    args.toLowerCase().startsWith(candidate.name.toLowerCase())
    && (args.length === candidate.name.length || /\s/.test(args[candidate.name.length]))
  ));
  if (named) {
    const input = args.slice(named.name.length).trim();
    if (!input) throw new Error(`No input provided for ${named.name}`);
    return { terminal: named, input };
  }
  return { terminal: resolveTerminal(projectKey), input: args };
}

export function terminalKeyData(key: string): string {
  const keys: Record<string, string> = {
    enter: "\r",
    escape: "\x1b",
    tab: "\t",
    "ctrl-c": "\x03",
    "ctrl-d": "\x04",
    up: "\x1b[A",
    down: "\x1b[B",
    right: "\x1b[C",
    left: "\x1b[D",
  };
  const data = keys[key];
  if (!data) throw new Error(`Unsupported terminal key: ${key}`);
  return data;
}

export function isHighRiskShellInput(input: string): boolean {
  return [
    /(^|[;&|]\s*)sudo\b/i,
    /(^|[;&|]\s*)rm\b[^\n]*(?:-[^\n]*r|--recursive|-[^\n]*f|--force)/i,
    /\bgit\s+(?:reset\s+--hard|clean\b|checkout\s+--|restore\b)/i,
    /(^|[;&|]\s*)(?:shutdown|reboot|halt|mkfs|diskutil\s+erase|dd\s+)\b/i,
    /(^|[;&|]\s*)(?:chmod|chown)\b[^\n]*-R\b/i,
    /(^|[;&|]\s*)(?:kill\s+-9|pkill|killall)\b/i,
    /\bnpm\s+publish\b/i,
  ].some((pattern) => pattern.test(input));
}

function requireTerminal(id: string): ManagedTerminal {
  const terminal = state().sessions.get(id);
  if (!terminal) throw new Error(`Terminal not found: ${id}`);
  return terminal;
}
