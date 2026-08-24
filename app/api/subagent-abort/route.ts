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

const AGENT_DIR = process.env.PI_CODING_AGENT_DIR ?? path.join(os.homedir(), ".pi", "agent");
const REGISTRY_PATH = path.join(AGENT_DIR, "subagent-running.json");
const CANCELLED_PATH = path.join(AGENT_DIR, "subagent-cancelled.json");

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

// 记录取消标记：扩展在每次 spawn 前检查，排队/后续任务不再启动（中止闭环）
function markCancelled(toolCallId: string): void {
  let list: { toolCallId: string; at: number }[] = [];
  try {
    const data = JSON.parse(fs.readFileSync(CANCELLED_PATH, "utf8"));
    if (Array.isArray(data)) list = data;
  } catch {
    /* ignore */
  }
  const fresh = list.filter((e) => typeof e?.at === "number" && Date.now() - e.at < 3600_000);
  if (!fresh.some((e) => e.toolCallId === toolCallId)) fresh.push({ toolCallId, at: Date.now() });
  try {
    fs.writeFileSync(CANCELLED_PATH, JSON.stringify(fresh));
  } catch {
    /* ignore */
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
  // 无论当前是否有存活进程都写取消标记：排队的并行任务/chain 后续步骤会被拦下
  markCancelled(toolCallId);
  if (targets.length === 0) {
    // 顺手清理 pid 已失效的陈旧条目
    writeRegistry(entries.filter((e) => isAlive(e.pid)));
    return NextResponse.json({ ok: true, killed: 0, cancelled: true });
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
    if (!isAlive(t.pid)) killed++;
  }

  // ponytail: read-modify-write without lock, concurrent writers may drop one entry
  const deadPids = new Set(targets.map((t) => t.pid));
  writeRegistry(readRegistry().filter((e) => !deadPids.has(e.pid) && isAlive(e.pid)));
  return NextResponse.json({ ok: true, killed, cancelled: true });
}
