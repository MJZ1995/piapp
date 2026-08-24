import { NextResponse } from "next/server";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// POST /api/subagent-abort - 中止运行中的 subagent 子进程
// body: { toolCallId: string, sessionId?: string }（sessionId 目前未用）
//
// subagent 扩展在 spawn 子进程时把 { pid, toolCallId, ... } 写入
// ~/.pi/agent/subagent-running.json，进程退出时移除。这里按 toolCallId
// 找到 pid 并 SIGTERM（2s 后仍存活补 SIGKILL）。

const REGISTRY_PATH = path.join(os.homedir(), ".pi", "agent", "subagent-running.json");

interface RegistryEntry {
  pid: number;
  toolCallId: string;
  agent?: string;
  task?: string;
  startedAt?: number;
}

function readRegistry(): RegistryEntry[] {
  try {
    const data = JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf8"));
    return Array.isArray(data) ? (data as RegistryEntry[]) : [];
  } catch {
    return [];
  }
}

function writeRegistry(entries: RegistryEntry[]): void {
  try {
    fs.writeFileSync(REGISTRY_PATH, JSON.stringify(entries));
  } catch {
    /* ignore */
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function POST(req: Request) {
  let body: { toolCallId?: unknown } | null = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
  const toolCallId = typeof body?.toolCallId === "string" ? body.toolCallId : "";
  if (!toolCallId) {
    return NextResponse.json({ ok: false, error: "missing toolCallId" }, { status: 400 });
  }

  const entries = readRegistry();
  const targets = entries.filter((e) => e.toolCallId === toolCallId && isAlive(e.pid));
  if (targets.length === 0) {
    // 顺手清理 pid 已失效的陈旧条目
    writeRegistry(entries.filter((e) => isAlive(e.pid)));
    return NextResponse.json({ ok: false, error: "no running subagent" }, { status: 404 });
  }

  for (const t of targets) {
    try {
      process.kill(t.pid, "SIGTERM");
    } catch {
      /* ignore */
    }
  }
  await sleep(2000);
  let killed = 0;
  for (const t of targets) {
    if (isAlive(t.pid)) {
      try {
        process.kill(t.pid, "SIGKILL");
      } catch {
        /* ignore */
      }
    }
    killed++;
  }

  const deadPids = new Set(targets.map((t) => t.pid));
  writeRegistry(readRegistry().filter((e) => !deadPids.has(e.pid) && isAlive(e.pid)));
  return NextResponse.json({ ok: true, killed });
}
