import fs from "fs";
import os from "os";
import path from "path";

// pi MCP 配置读写（pi-mcp-adapter 语义）：全局 ~/.pi/agent/mcp.json + 项目 <cwd>/.pi/mcp.json，
// 项目层字段级覆盖全局层（主要是 disabled 标记）。
export type McpServerEntry = Record<string, unknown> & { disabled?: boolean };
export type McpConfig = { mcpServers: Record<string, McpServerEntry> } & Record<string, unknown>;

export interface McpServerInfo {
  name: string;
  summary: string;
  disabled: boolean;
}

export function globalConfigFile(): string {
  return path.join(os.homedir(), ".pi", "agent", "mcp.json");
}

export function projectConfigFile(cwd: string): string | null {
  return cwd && path.isAbsolute(cwd) ? path.join(cwd, ".pi", "mcp.json") : null;
}

export function readConfig(file: string): McpConfig {
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!raw || typeof raw !== "object") return { mcpServers: {} };
    return { ...raw, mcpServers: (raw.mcpServers ?? {}) as Record<string, McpServerEntry> };
  } catch {
    return { mcpServers: {} };
  }
}

export function writeConfig(file: string, config: McpConfig): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  fs.writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

export function summarize(entry: McpServerEntry): string {
  if (typeof entry.url === "string") return entry.url;
  if (typeof entry.command === "string") {
    const args = Array.isArray(entry.args) ? entry.args.filter((a): a is string => typeof a === "string") : [];
    return [entry.command, ...args].join(" ");
  }
  return "";
}

/** True when the entry holds the server definition itself, not just a flag overlay. */
export function isDefinition(entry: McpServerEntry | undefined): boolean {
  return !!entry && (entry.url !== undefined || entry.command !== undefined);
}

export function listMcpServers(cwd: string): McpServerInfo[] {
  const globalConf = readConfig(globalConfigFile());
  const projectFile = projectConfigFile(cwd);
  const projectConf = projectFile ? readConfig(projectFile) : { mcpServers: {} };
  const names = [...new Set([...Object.keys(globalConf.mcpServers), ...Object.keys(projectConf.mcpServers)])]
    .sort((a, b) => a.localeCompare(b));
  return names.map((name) => {
    const g = globalConf.mcpServers[name];
    const p = projectConf.mcpServers[name];
    const definition = isDefinition(g) ? g : isDefinition(p) ? p : { ...g, ...p };
    return { name, summary: summarize(definition), disabled: p?.disabled ?? g?.disabled ?? false };
  });
}

/** Returns false when the server is unknown. */
export function setMcpServerDisabled(cwd: string, name: string, disabled: boolean): boolean {
  const projectFile = projectConfigFile(cwd);
  const projectConf = projectFile ? readConfig(projectFile) : { mcpServers: {} };
  // The layer holding the actual definition owns the flag; overlays live elsewhere.
  const owningFile = isDefinition(projectConf.mcpServers[name]) && projectFile ? projectFile : globalConfigFile();

  const conf = readConfig(owningFile);
  const entry = conf.mcpServers[name];
  if (!entry) return false;
  if (disabled) entry.disabled = true;
  else delete entry.disabled;
  writeConfig(owningFile, conf);

  // Enabling also clears pure-overlay `disabled` flags on BOTH layers — otherwise the
  // merge keeps reporting the server as disabled.
  if (!disabled) {
    for (const file of [globalConfigFile(), projectFile]) {
      if (!file || file === owningFile) continue;
      const c = readConfig(file);
      const overlay = c.mcpServers[name];
      if (overlay && !isDefinition(overlay) && overlay.disabled !== undefined) {
        delete overlay.disabled;
        if (Object.keys(overlay).length === 0) delete c.mcpServers[name];
        writeConfig(file, c);
      }
    }
  }
  return true;
}
