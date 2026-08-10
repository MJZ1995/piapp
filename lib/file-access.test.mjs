import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { inspectDeleteTarget } = await jiti.import("./file-access.ts");

test("delete targets stay inside the project and cannot remove its root", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-delete-root-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-delete-outside-"));
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });

  const file = path.join(root, "file.txt");
  const directory = path.join(root, "folder");
  const link = path.join(root, "outside-link");
  fs.writeFileSync(file, "safe");
  fs.mkdirSync(directory);
  fs.writeFileSync(path.join(outside, "victim.txt"), "keep");
  fs.symlinkSync(outside, link, "dir");

  const roots = new Set([root]);
  assert.deepEqual(inspectDeleteTarget(file, roots), { ok: true, isDirectory: false });
  assert.deepEqual(inspectDeleteTarget(directory, roots), { ok: true, isDirectory: true });
  assert.deepEqual(inspectDeleteTarget(root, roots), { ok: false, error: "Cannot delete a project root", status: 400 });
  assert.deepEqual(inspectDeleteTarget("c:\\PROJECT", new Set(["C:\\Project"])), { ok: false, error: "Cannot delete a project root", status: 400 });
  assert.deepEqual(inspectDeleteTarget(outside, roots), { ok: false, error: "Access denied", status: 403 });
  assert.deepEqual(inspectDeleteTarget(link, roots), { ok: true, isDirectory: false });
  assert.deepEqual(inspectDeleteTarget(path.join(link, "victim.txt"), roots), { ok: false, error: "Access denied", status: 403 });
});

// Loaded through jiti so the module's own extensionless imports resolve the way
// the app resolves them (tsconfig moduleResolution: "bundler"); bare
// `import("./path-security.ts")` only works while that file has no imports.
async function loadSubject() {
  const { createJiti } = await import("jiti");
  return createJiti(import.meta.url).import("./path-security.ts");
}

test("rejects an existing path that escapes an allowed root through a symlink", async (t) => {
  const { isExistingPathWithinRoots, isPathWithinRoots } = await loadSubject();
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-file-access-"));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const allowed = path.join(base, "allowed");
  const outside = path.join(base, "outside");
  fs.mkdirSync(allowed);
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, "secret.txt"), "secret");
  const link = path.join(allowed, "link");
  fs.symlinkSync(outside, link, process.platform === "win32" ? "junction" : "dir");
  const target = path.join(link, "secret.txt");
  const roots = new Set([allowed]);

  assert.equal(isPathWithinRoots(target, roots), true);
  assert.equal(isExistingPathWithinRoots(target, roots), false);
});
