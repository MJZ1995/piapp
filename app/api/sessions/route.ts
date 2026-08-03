import { NextResponse } from "next/server";
import { existsSync } from "fs";
import { listAllSessions } from "@/lib/session-reader";
import { getRunningRpcSessionIds } from "@/lib/rpc-manager";

// 项目下拉只把磁盘上仍存在的目录列为正常项目；目录被改名/删除但仍有会话的，
// 返回 archivedProjects 供前端以「已移动」分组展示，保证历史会话永远可访问。
// 会话历史本身不受影响，仍可正常查看。
function listProjects(sessions: Awaited<ReturnType<typeof listAllSessions>>): { projects: string[]; archivedProjects: string[] } {
  const latestByRoot = new Map<string, string>();
  for (const s of sessions) {
    const root = s.projectRoot ?? s.cwd;
    if (!root) continue;
    const prev = latestByRoot.get(root);
    if (!prev || s.modified > prev) latestByRoot.set(root, s.modified);
  }
  const sorted = [...latestByRoot.entries()].sort((a, b) => b[1].localeCompare(a[1])).map(([root]) => root);
  const exists = (root: string) => { try { return existsSync(root); } catch { return false; } };
  return { projects: sorted.filter(exists), archivedProjects: sorted.filter((root) => !exists(root)) };
}

export async function GET() {
  try {
    const sessions = await listAllSessions();
    return NextResponse.json({ sessions, runningSessionIds: getRunningRpcSessionIds(), ...listProjects(sessions) });
  } catch (error) {
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}
