import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

process.env.PI_WEB_DESKTOP = "1";
const jiti = createJiti(import.meta.url);
const manager = await jiti.import("./terminal-manager.ts");

function waitForData(id, match, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error("Timed out waiting for terminal output"));
    }, timeoutMs);
    const unsubscribe = manager.subscribeTerminal(id, (event) => {
      if (event.type !== "data") return;
      output += event.data;
      if (!match(output)) return;
      clearTimeout(timeout);
      unsubscribe();
      resolve();
    });
  });
}

test("runs a PTY, reads its screen, and resolves named slash targets", async (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "yasuo-terminal-"));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));

  const terminal = manager.createTerminal({ cwd, projectKey: cwd, name: "Kimi" });
  t.after(() => {
    try { manager.closeTerminal(terminal.id); } catch { /* already closed */ }
  });

  await waitForData(terminal.id, (output) => output.includes("%"));
  manager.writeTerminal(terminal.id, "printf '\\e[32mPTY_OK\\e[0m\\n'\r");
  await waitForData(terminal.id, (output) => output.includes("PTY_OK"));
  await new Promise((resolve) => setTimeout(resolve, 300));

  assert.match(manager.readTerminal(terminal.id, 20), /PTY_OK/);
  assert.equal(manager.resolveTerminal(cwd, "kimi").id, terminal.id);
  assert.deepEqual(manager.parseTerminalCommand(cwd, "Kimi hello"), {
    terminal: manager.getTerminal(terminal.id),
    input: "hello",
  });
  assert.equal(manager.terminalSnapshot(terminal.id).includes("PTY_OK"), true);

  manager.setTerminalTrusted(terminal.id, true);
  const exited = new Promise((resolve) => {
    const unsubscribe = manager.subscribeTerminal(terminal.id, (event) => {
      if (event.type !== "exit") return;
      unsubscribe();
      resolve();
    });
  });
  manager.writeTerminal(terminal.id, "exit\r");
  await exited;
  assert.equal(manager.getTerminal(terminal.id).running, false);
  assert.equal(manager.getTerminal(terminal.id).trusted, false);
});

test("classifies destructive shell input without blocking ordinary commands", () => {
  assert.equal(manager.isHighRiskShellInput("git status"), false);
  assert.equal(manager.isHighRiskShellInput("npm run build"), false);
  assert.equal(manager.isHighRiskShellInput("rm -rf dist"), true);
  assert.equal(manager.isHighRiskShellInput("git reset --hard HEAD~1"), true);
  assert.equal(manager.isHighRiskShellInput("sudo launchctl unload service"), true);
});
