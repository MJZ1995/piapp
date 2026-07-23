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
