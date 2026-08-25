import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "os";
import path from "path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-config-test-"));
process.env.HOME = tmpHome;

const { listMcpServers, setMcpServerDisabled, writeConfig, globalConfigFile } = await jiti.import("./mcp-config.ts");

function writeGlobal(servers) {
  writeConfig(globalConfigFile(), { mcpServers: servers });
}

test("lists global servers with summaries", () => {
  writeGlobal({ amplitude: { url: "https://mcp.amplitude.com/mcp", auth: "oauth" } });
  const servers = listMcpServers("");
  assert.equal(servers.length, 1);
  assert.equal(servers[0].name, "amplitude");
  assert.equal(servers[0].summary, "https://mcp.amplitude.com/mcp");
  assert.equal(servers[0].disabled, false);
});

test("disable writes the flag and enable removes it", () => {
  assert.equal(setMcpServerDisabled("", "amplitude", true), true);
  assert.equal(listMcpServers("")[0].disabled, true);
  assert.equal(setMcpServerDisabled("", "amplitude", false), true);
  assert.equal(listMcpServers("")[0].disabled, false);
});

test("enable clears a project-layer disabled overlay while keeping the global definition", () => {
  const cwd = fs.mkdtempSync(path.join(tmpHome, "proj-"));
  writeGlobal({ amplitude: { url: "https://mcp.amplitude.com/mcp", auth: "oauth" } });
  fs.mkdirSync(path.join(cwd, ".pi"), { recursive: true });
  writeConfig(path.join(cwd, ".pi", "mcp.json"), { mcpServers: { amplitude: { disabled: true } } });
  assert.equal(listMcpServers(cwd)[0].disabled, true);
  setMcpServerDisabled(cwd, "amplitude", false);
  assert.equal(listMcpServers(cwd)[0].disabled, false);
});

test("unknown server returns false", () => {
  assert.equal(setMcpServerDisabled("", "nope", true), false);
});

fs.rmSync(tmpHome, { recursive: true, force: true });
