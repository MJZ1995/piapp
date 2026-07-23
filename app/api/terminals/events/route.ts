import { NextRequest, NextResponse } from "next/server";
import { resolveTerminalContext } from "@/lib/terminal-access";
import {
  getTerminal,
  subscribeTerminal,
  terminalSnapshot,
  terminalsEnabled,
  type TerminalEvent,
} from "@/lib/terminal-manager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!terminalsEnabled()) {
    return NextResponse.json({ error: "Terminal is unavailable" }, { status: 404 });
  }

  const id = request.nextUrl.searchParams.get("id") ?? "";
  const cwd = request.nextUrl.searchParams.get("cwd") ?? "";
  try {
    const context = await resolveTerminalContext(cwd);
    const terminal = getTerminal(id);
    if (!terminal) return NextResponse.json({ error: "Terminal not found" }, { status: 404 });
    if (terminal.projectKey !== context.projectKey) {
      return NextResponse.json({ error: "Terminal access denied" }, { status: 403 });
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let ready = false;
      const pending: TerminalEvent[] = [];
      const send = (name: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          unsubscribe?.();
          if (heartbeat) clearInterval(heartbeat);
        }
      };
      const forward = (event: TerminalEvent) => {
        if (!ready) {
          pending.push(event);
          return;
        }
        send(event.type, event);
      };

      unsubscribe = subscribeTerminal(id, forward);
      send("snapshot", { data: terminalSnapshot(id), terminal: getTerminal(id) });
      ready = true;
      for (const event of pending) send(event.type, event);
      heartbeat = setInterval(() => send("ping", { at: Date.now() }), 15_000);
    },
    cancel() {
      unsubscribe?.();
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
