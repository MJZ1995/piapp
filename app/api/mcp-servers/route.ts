import { NextResponse } from "next/server";
import fs from "fs";
import os from "os";
import path from "path";

// Reads and writes pi's MCP configuration. Layers (pi-mcp-adapter semantics):
// global ~/.pi/agent/mcp.json plus the project-local <cwd>/.pi/mcp.json, whose
// entries override the global layer field-by-field (notably `disabled`).
type McpServerEntry = Record<string, unknown> & { disabled?: boolean };
type McpConfig = { mcpServers: Record<string, McpServerEntry> } & Record<string, unknown>;

function globalConfigFile(): string {
  return path.join(os.homedir(), ".pi", "agent", "mcp.json");
}

function projectConfigFile(cwd: string): string | null {
  return cwd && path.isAbsolute(cwd) ? path.join(cwd, ".pi", "mcp.json") : null;
}

function readConfig(file: string): McpConfig {
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!raw || typeof raw !== "object") return { mcpServers: {} };
    return { ...raw, mcpServers: (raw.mcpServers ?? {}) as Record<string, McpServerEntry> };
  } catch {
    return { mcpServers: {} };
  }
}

function writeConfig(file: string, config: McpConfig): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

function summarize(entry: McpServerEntry): string {
  if (typeof entry.url === "string") return entry.url;
  if (typeof entry.command === "string") {
    const args = Array.isArray(entry.args) ? entry.args.filter((a): a is string => typeof a === "string") : [];
    return [entry.command, ...args].join(" ");
  }
  return "";
}

/** True when the entry holds the server definition itself, not just a flag overlay. */
function isDefinition(entry: McpServerEntry | undefined): boolean {
  return !!entry && (entry.url !== undefined || entry.command !== undefined);
}

export async function GET(req: Request) {
  const cwd = new URL(req.url).searchParams.get("cwd") ?? "";
  const globalConf = readConfig(globalConfigFile());
  const projectFile = projectConfigFile(cwd);
  const projectConf = projectFile ? readConfig(projectFile) : { mcpServers: {} };

  const names = [...new Set([...Object.keys(globalConf.mcpServers), ...Object.keys(projectConf.mcpServers)])]
    .sort((a, b) => a.localeCompare(b));
  const servers = names.map((name) => {
    const g = globalConf.mcpServers[name];
    const p = projectConf.mcpServers[name];
    const definition = isDefinition(g) ? g : isDefinition(p) ? p : { ...g, ...p };
    return {
      name,
      summary: summarize(definition),
      disabled: p?.disabled ?? g?.disabled ?? false,
    };
  });
  return NextResponse.json({ servers });
}

export async function PATCH(req: Request) {
  const body = await req.json().catch(() => null) as { cwd?: unknown; name?: unknown; disabled?: unknown } | null;
  const cwd = typeof body?.cwd === "string" ? body.cwd : "";
  const name = body?.name;
  const disabled = body?.disabled;
  if (typeof name !== "string" || !name.trim() || typeof disabled !== "boolean") {
    return NextResponse.json({ error: "name and disabled are required" }, { status: 400 });
  }

  const projectFile = projectConfigFile(cwd);
  const projectConf = projectFile ? readConfig(projectFile) : { mcpServers: {} };
  // The layer holding the actual definition owns the flag; overlays live elsewhere.
  const owningFile = isDefinition(projectConf.mcpServers[name]) ? projectFile! : globalConfigFile();

  const conf = readConfig(owningFile);
  const entry = conf.mcpServers[name];
  if (!entry) return NextResponse.json({ error: "unknown server" }, { status: 404 });
  if (disabled) entry.disabled = true;
  else delete entry.disabled;
  writeConfig(owningFile, conf);

  // Enabling must also clear a pure-overlay `disabled` flag on the other layer,
  // otherwise the merge keeps reporting the server as disabled.
  if (!disabled && projectFile) {
    const overlay = projectConf.mcpServers[name];
    if (overlay && !isDefinition(overlay) && overlay.disabled !== undefined) {
      delete overlay.disabled;
      if (Object.keys(overlay).length === 0) delete projectConf.mcpServers[name];
      writeConfig(projectFile, projectConf);
    }
  }

  return NextResponse.json({ ok: true });
}
