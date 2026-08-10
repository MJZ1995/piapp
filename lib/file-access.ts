import { lstatSync, readdirSync, realpathSync } from "fs";
import { homedir } from "os";
import path from "path";
import { getAdditionalAllowedRoots, normalizeSlashes } from "./allowed-roots";
import { isExistingPathWithinRoots, isPathWithinRoots } from "./path-security";
import { listAllSessions } from "./session-reader";
export { allowFileRoot, normalizeSlashes } from "./allowed-roots";
import { isWindowsAbsolutePath } from "./paths";
export { isWindowsAbsolutePath } from "./paths";

// Short-TTL cache for the allowed-roots set. Without this, every file list/read
// request re-scans every pi session on disk just to check access. 5s is short
// enough that newly-created cwds appear promptly; stored on globalThis so it
// survives Next.js hot-reload.
declare global {
  var __piAllowedRootsCache: { roots: Set<string>; expiresAt: number } | undefined;
}

const ALLOWED_ROOTS_TTL_MS = 5_000;

export async function getAllowedFileRoots(): Promise<Set<string>> {
  const now = Date.now();
  const cached = globalThis.__piAllowedRootsCache;
  if (cached && cached.expiresAt > now) return cached.roots;

  const sessions = await listAllSessions();
  const roots = new Set<string>();
  for (const s of sessions) {
    if (s.cwd) roots.add(normalizeSlashes(s.cwd));
    // The project root (main repo shared by all worktrees) is browsable too —
    // the project dropdown lists it even when only worktrees have sessions.
    if (s.projectRoot) roots.add(normalizeSlashes(s.projectRoot));
  }

  // Also allow ~/pi-cwd-* directories created by the default-cwd endpoint.
  try {
    for (const name of readdirSync(homedir())) {
      if (/^pi-cwd-\d{8}$/.test(name)) {
        roots.add(normalizeSlashes(path.join(homedir(), name)));
      }
    }
  } catch {
    // ignore if home is unreadable
  }

  for (const root of getAdditionalAllowedRoots()) roots.add(root);

  globalThis.__piAllowedRootsCache = { roots, expiresAt: now + ALLOWED_ROOTS_TTL_MS };
  return roots;
}

/** Authorize a path lexically, without touching the filesystem. */
export function isFilePathAllowed(target: string, allowedRoots: Set<string>): boolean {
  return isPathWithinRoots(target, allowedRoots);
}

/** Authorize an existing path after resolving symbolic links. */
export function isExistingFilePathAllowed(target: string, allowedRoots: Set<string>): boolean {
  return isExistingPathWithinRoots(target, allowedRoots);
}

type DeleteTargetInspection =
  | { ok: true; isDirectory: boolean }
  | { ok: false; error: string; status: 400 | 403 | 404 };

function isSameFilePath(left: string, right: string): boolean {
  const useWindowsRules = isWindowsAbsolutePath(left) || isWindowsAbsolutePath(right);
  const resolver = useWindowsRules ? path.win32 : path;
  const resolvedLeft = resolver.resolve(left);
  const resolvedRight = resolver.resolve(right);
  return useWindowsRules
    ? resolvedLeft.toLowerCase() === resolvedRight.toLowerCase()
    : resolvedLeft === resolvedRight;
}

export function inspectDeleteTarget(target: string, allowedRoots: Set<string>): DeleteTargetInspection {
  if (!isFilePathAllowed(target, allowedRoots)) {
    return { ok: false, error: "Access denied", status: 403 };
  }

  if ([...allowedRoots].some((root) => isSameFilePath(target, root))) {
    return { ok: false, error: "Cannot delete a project root", status: 400 };
  }

  let stat;
  try {
    stat = lstatSync(target);
  } catch {
    return { ok: false, error: "Not found", status: 404 };
  }

  const realRoots = new Set<string>();
  for (const root of allowedRoots) {
    try {
      realRoots.add(realpathSync(root));
    } catch {
      // Ignore stale roots.
    }
  }

  try {
    const realParent = realpathSync(path.dirname(target));
    if (!isFilePathAllowed(realParent, realRoots)) {
      return { ok: false, error: "Access denied", status: 403 };
    }
    // Removing a symlink removes the link itself; resolving it would wrongly
    // reject safe deletion of links whose targets are outside the project.
    if (!stat.isSymbolicLink() && !isFilePathAllowed(realpathSync(target), realRoots)) {
      return { ok: false, error: "Access denied", status: 403 };
    }
  } catch {
    return { ok: false, error: "Access denied", status: 403 };
  }

  return { ok: true, isDirectory: stat.isDirectory() };
}
