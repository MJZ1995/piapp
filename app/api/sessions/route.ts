import { NextResponse } from "next/server";
import { existsSync } from "fs";
import {
  attachSessionProjectInfo,
  listAllSessions,
  mergeSessionLists,
} from "@/lib/session-reader";
import {
  getCompletionNotificationSuppressedRpcSessionIds,
  getRpcSessionInfos,
  getRunningRpcSessionIds,
} from "@/lib/rpc-manager";

export const dynamic = "force-dynamic";


// 项目下拉只把磁盘上仍存在的目录列为正常项目；目录被改名/删除但仍有会话的，
// 返回 archivedProjects 供前端以「已移动」分组展示，保证历史会话永远可访问。
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

export async function GET(req: Request) {
  try {
    const force = new URL(req.url).searchParams.get("force") === "1";
    const [persistedSessions, runtimeSessions] = await Promise.all([
      listAllSessions({ force }),
      attachSessionProjectInfo(getRpcSessionInfos()),
    ]);
    const sessions = mergeSessionLists(persistedSessions, runtimeSessions);
    return NextResponse.json(
      {
        sessions,
        runningSessionIds: getRunningRpcSessionIds(),
        completionNotificationSuppressedSessionIds: getCompletionNotificationSuppressedRpcSessionIds(),
        ...listProjects(sessions),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: String(error) },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
