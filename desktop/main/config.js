/* eslint-disable @typescript-eslint/no-require-imports -- Electron 主进程使用 CommonJS */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const DEFAULT_PORT = 30141;
const DEFAULT_SHORTCUT = "Alt+Space";

function isValidRepo(dir) {
  return !!dir && fs.existsSync(path.join(dir, "bin", "pi-web.js"));
}

function candidateRepoPaths() {
  return [
    // 开发布局：desktop/ 就在仓库内
    path.resolve(__dirname, "..", ".."),
    // plan.md 约定的标准位置
    path.join(os.homedir(), "Desktop", "Pi App", "pi-web"),
  ];
}

class Config {
  constructor(app, log) {
    this.log = log || (() => {});
    this.file = path.join(app.getPath("userData"), "config.json");
    let raw = {};
    try { raw = JSON.parse(fs.readFileSync(this.file, "utf8")); } catch { /* 首次运行 */ }
    this.raw = raw;
    this.port = Number(raw.port) || DEFAULT_PORT;
    this.shortcut = typeof raw.shortcut === "string" && raw.shortcut ? raw.shortcut : DEFAULT_SHORTCUT;
    this.nodePath = typeof raw.nodePath === "string" && raw.nodePath ? raw.nodePath : null;
    this.repoPath = this._resolveRepoPath(raw.repoPath);
  }

  _resolveRepoPath(fromFile) {
    if (fromFile) {
      const ok = isValidRepo(fromFile);
      this.log(`repoPath from config: ${fromFile} -> ${ok ? "valid" : "INVALID"}`);
      if (ok) return fromFile;
    }
    for (const c of candidateRepoPaths()) {
      const ok = isValidRepo(c);
      this.log(`repoPath candidate: ${c} -> ${ok ? "valid" : "invalid"}`);
      if (ok) return c;
    }
    return null; // 由 main.js 弹目录选择框
  }

  set(partial) {
    Object.assign(this.raw, partial);
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.raw, null, 2));
    } catch { /* 忽略写盘失败 */ }
    if (partial.repoPath) this.repoPath = partial.repoPath;
    if (partial.nodePath) this.nodePath = partial.nodePath;
  }
}

module.exports = { Config, isValidRepo };
