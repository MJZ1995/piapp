import fs from "fs";
import path from "path";
import { getAllowedFileRoots, isFilePathAllowed } from "./file-access";
import { resolveProject } from "./worktree";

export interface TerminalContext {
  cwd: string;
  projectKey: string;
}

export async function resolveTerminalContext(cwd: string): Promise<TerminalContext> {
  if (!cwd || !path.isAbsolute(cwd)) throw new Error("A valid terminal cwd is required");

  const allowedRoots = await getAllowedFileRoots();
  if (!isFilePathAllowed(cwd, allowedRoots)) throw new Error("Terminal access denied");

  let realCwd: string;
  try {
    realCwd = fs.realpathSync(cwd);
    if (!fs.statSync(realCwd).isDirectory()) throw new Error("not a directory");
  } catch {
    throw new Error("Terminal directory not found");
  }

  const realRoots = new Set<string>();
  for (const root of allowedRoots) {
    try { realRoots.add(fs.realpathSync(root)); } catch { /* stale root */ }
  }
  if (!isFilePathAllowed(realCwd, realRoots)) throw new Error("Terminal access denied");

  const project = await resolveProject(realCwd);
  return { cwd: realCwd, projectKey: path.resolve(project.projectRoot) };
}
