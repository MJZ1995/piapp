import { NextRequest, NextResponse } from "next/server";
import { resolveTerminalContext } from "@/lib/terminal-access";
import {
  activateTerminal,
  closeTerminal,
  createTerminal,
  getTerminal,
  hasTerminalChildProcess,
  listTerminals,
  parseTerminalCommand,
  renameTerminal,
  resizeTerminal,
  setTerminalFocused,
  setTerminalTrusted,
  terminalsEnabled,
  writeTerminal,
} from "@/lib/terminal-manager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TerminalAction =
  | "create"
  | "write"
  | "resize"
  | "activate"
  | "rename"
  | "trust"
  | "focus"
  | "close"
  | "command";

type TerminalRequestBody = {
  action?: TerminalAction;
  cwd?: string;
  id?: string;
  name?: string;
  data?: string;
  cols?: number;
  rows?: number;
  trusted?: boolean;
  focused?: boolean;
  force?: boolean;
  args?: string;
};

function errorResponse(error: unknown, fallbackStatus = 400): NextResponse {
  const message = error instanceof Error ? error.message : String(error);
  const status = message.includes("not found") || message.includes("No terminal") ? 404 : fallbackStatus;
  return NextResponse.json({ error: message }, { status });
}

async function scopedTerminal(cwd: string, id: string) {
  const context = await resolveTerminalContext(cwd);
  const terminal = getTerminal(id);
  if (!terminal) throw new Error(`Terminal not found: ${id}`);
  if (terminal.projectKey !== context.projectKey) throw new Error("Terminal access denied");
  return { context, terminal };
}

export async function GET(request: NextRequest) {
  if (!terminalsEnabled()) return NextResponse.json({ enabled: false, terminals: [] });
  try {
    const cwd = request.nextUrl.searchParams.get("cwd") ?? "";
    if (!cwd) return NextResponse.json({ enabled: true, terminals: [] });
    const context = await resolveTerminalContext(cwd);
    return NextResponse.json({ enabled: true, terminals: listTerminals(context.projectKey) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  if (!terminalsEnabled()) {
    return NextResponse.json({ error: "Terminal is available only in PiPi Agent desktop mode" }, { status: 404 });
  }

  let body: TerminalRequestBody;
  try {
    body = await request.json() as TerminalRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const cwd = body.cwd ?? "";
  const action = body.action;
  if (!action) return NextResponse.json({ error: "Terminal action is required" }, { status: 400 });

  try {
    if (action === "create") {
      const context = await resolveTerminalContext(cwd);
      const terminal = createTerminal({
        cwd: context.cwd,
        projectKey: context.projectKey,
        name: body.name,
        cols: body.cols,
        rows: body.rows,
      });
      return NextResponse.json({ terminal });
    }

    if (action === "command") {
      const context = await resolveTerminalContext(cwd);
      const { terminal, input } = parseTerminalCommand(context.projectKey, body.args ?? "");
      writeTerminal(terminal.id, `${input}\r`, "user");
      activateTerminal(terminal.id);
      return NextResponse.json({ terminal: getTerminal(terminal.id), input });
    }

    if (!body.id) return NextResponse.json({ error: "Terminal id is required" }, { status: 400 });
    const { terminal } = await scopedTerminal(cwd, body.id);

    switch (action) {
      case "write":
        writeTerminal(terminal.id, body.data ?? "", "user");
        return NextResponse.json({ ok: true });
      case "resize":
        return NextResponse.json({ terminal: resizeTerminal(terminal.id, body.cols ?? 100, body.rows ?? 28) });
      case "activate":
        return NextResponse.json({ terminal: activateTerminal(terminal.id) });
      case "rename":
        return NextResponse.json({ terminal: renameTerminal(terminal.id, body.name ?? "") });
      case "trust":
        return NextResponse.json({ terminal: setTerminalTrusted(terminal.id, body.trusted === true) });
      case "focus":
        return NextResponse.json({ terminal: setTerminalFocused(terminal.id, body.focused === true) });
      case "close":
        if (!body.force && hasTerminalChildProcess(terminal.id)) {
          return NextResponse.json({ error: "Terminal has a running child process", busy: true }, { status: 409 });
        }
        closeTerminal(terminal.id);
        return NextResponse.json({ ok: true });
      default:
        return NextResponse.json({ error: `Unsupported terminal action: ${action}` }, { status: 400 });
    }
  } catch (error) {
    return errorResponse(error);
  }
}
