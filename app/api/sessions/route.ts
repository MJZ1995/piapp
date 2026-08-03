import { NextResponse } from "next/server";
import { existsSync } from "fs";
import { listAllSessions } from "@/lib/session-reader";
import { getRunningRpcSessionIds } from "@/lib/rpc-manager";

// 项目下拉只展示磁盘上仍存在的目录：文件夹被改名/删除后，旧路径不再出现。
// 会话历史本身不受影响，仍可正常查看。
function listExistingProjects(sessions: Awaited<ReturnType<typeof listAllSessions>>): string[] {
  const latestByRoot = new Map<string, string>();
  for (const s of sessions) {
    const root = s.projectRoot ?? s.cwd;
    if (!root) continue;
    const prev = latestByRoot.get(root);
    if (!prev || s.modified > prev) latestByRoot.set(root, s.modified);
  }
  return [...latestByRoot.entries()]
    .filter(([root]) => { try { return existsSync(root); } catch { return false; } })
    .sort((a, b) => b[1].localeCompare(a[1]))
    .map(([root]) => root);
}

export async function GET() {
  try {
    const sessions = await listAllSessions();
    return NextResponse.json({ sessions, runningSessionIds: getRunningRpcSessionIds(), projects: listExistingProjects(sessions) });
  } catch (error) {
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}
