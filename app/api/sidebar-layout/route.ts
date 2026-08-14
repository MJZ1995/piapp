import { NextResponse } from "next/server";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export const dynamic = "force-dynamic";

const MAX_ORDER = 500;
const MAX_GROUPS = 100;
const MAX_NAME = 80;

interface Store {
  projects: Record<string, unknown>;
}

function storePath(): string {
  return join(getAgentDir(), "sidebar-layout.json");
}

function readStore(): Store {
  try {
    const data = JSON.parse(readFileSync(storePath(), "utf8")) as Store;
    if (data && typeof data === "object" && data.projects) return data;
  } catch { /* 首次或损坏时重置 */ }
  return { projects: {} };
}

function writeStore(store: Store): void {
  const dir = dirname(storePath());
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(storePath(), JSON.stringify(store, null, 2), "utf8");
}

function sanitizeLayout(input: unknown): { order: string[]; groups: Record<string, { name: string; collapsed: boolean; order: string[] }> } | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as { order?: unknown; groups?: unknown };
  if (!Array.isArray(raw.order) || !raw.groups || typeof raw.groups !== "object") return null;
  const order = raw.order.filter((k): k is string => typeof k === "string" && /^(s|g):[^\s]{1,200}$/.test(k)).slice(0, MAX_ORDER);
  const groups: Record<string, { name: string; collapsed: boolean; order: string[] }> = {};
  for (const [gid, g] of Object.entries(raw.groups as Record<string, unknown>).slice(0, MAX_GROUPS)) {
    if (!/^[\w-]{1,64}$/.test(gid)) continue;
    const group = g as { name?: unknown; collapsed?: unknown; order?: unknown };
    if (!group || typeof group !== "object") continue;
    groups[gid] = {
      name: typeof group.name === "string" ? group.name.slice(0, MAX_NAME) : "分组",
      collapsed: group.collapsed === true,
      order: Array.isArray(group.order) ? group.order.filter((id): id is string => typeof id === "string" && id.length <= 200).slice(0, MAX_ORDER) : [],
    };
  }
  return { order, groups };
}

export async function GET(req: Request) {
  const cwd = new URL(req.url).searchParams.get("cwd");
  if (!cwd) return NextResponse.json({ error: "cwd required" }, { status: 400 });
  const layout = readStore().projects[cwd] ?? { order: [], groups: {} };
  return NextResponse.json(layout);
}

export async function PUT(req: Request) {
  try {
    const body = await req.json() as { cwd?: unknown; layout?: unknown };
    if (typeof body.cwd !== "string" || !body.cwd) {
      return NextResponse.json({ error: "cwd required" }, { status: 400 });
    }
    const layout = sanitizeLayout(body.layout);
    if (!layout) return NextResponse.json({ error: "invalid layout" }, { status: 400 });
    const store = readStore();
    store.projects[body.cwd] = layout;
    writeStore(store);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
