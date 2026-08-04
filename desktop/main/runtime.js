/* eslint-disable @typescript-eslint/no-require-imports -- Electron 主进程使用 CommonJS */
"use strict";

// 自包含运行时（同事分发模式）：打包且无 repoPath 配置时，
// 从 App 资源释放运行时到 userData 并以此为服务根目录。
// 开发模式（有 repoPath）完全不受影响。

const fs = require("fs");
const path = require("path");

function readManifest(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  } catch {
    return null;
  }
}

function copyDirSync(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDirSync(s, d);
    else if (entry.isSymbolicLink()) {
      try { fs.symlinkSync(fs.readlinkSync(s), d); } catch { /* 已存在 */ }
    } else {
      fs.copyFileSync(s, d);
      fs.chmodSync(d, fs.statSync(s).mode);
    }
  }
}

// 返回 { repoPath, nodePath } 或 null（非自包含模式）
function resolvePackagedRuntime({ app, cfg, log }) {
  if (!app.isPackaged) return null;
  if (cfg.repoPath && !process.env.PI_WEB_DESKTOP_SELFCONTAINED) {
    log("检测到 repoPath 配置，使用开发模式（本机仓库 + 系统 Node）");
    return null;
  }

  const bundled = path.join(process.resourcesPath, "runtime");
  if (!fs.existsSync(path.join(bundled, "pi-web", "bin", "pi-web.js"))) {
    log("App 资源中未找到内置运行时，回退到仓库选择流程");
    return null;
  }

  const target = path.join(app.getPath("userData"), "runtime");
  const bundledVer = (readManifest(bundled) || {}).version || "0";
  const localVer = (readManifest(target) || {}).version || null;

  if (bundledVer !== localVer) {
    log(`释放内置运行时 v${bundledVer}（当前 ${localVer ?? "无"}）`);
    const staging = `${target}.new`;
    const backup = `${target}.previous`;
    try {
      fs.rmSync(staging, { recursive: true, force: true });
      copyDirSync(bundled, staging);
      // node 与 node-pty 原生模块需要执行权限
      try { fs.chmodSync(path.join(staging, "node"), 0o755); } catch { /* ignore */ }
      const spawnHelper = path.join(staging, "pi-web", "node_modules", "node-pty", "build", "Release", "spawn-helper");
      try { fs.chmodSync(spawnHelper, 0o755); } catch { /* ignore */ }
      fs.rmSync(backup, { recursive: true, force: true });
      if (fs.existsSync(target)) fs.renameSync(target, backup);
      fs.renameSync(staging, target);
      fs.rmSync(backup, { recursive: true, force: true });
    } catch (e) {
      log("运行时释放失败：", (e && e.message) || e);
      if (!fs.existsSync(target)) throw e;
      log("使用已存在的运行时继续");
    }
  } else {
    log(`内置运行时 v${bundledVer} 已就绪`);
  }

  return {
    repoPath: path.join(target, "pi-web"),
    nodePath: path.join(target, "node"),
    runtimeVersion: bundledVer,
  };
}

module.exports = { resolvePackagedRuntime, readManifest };
