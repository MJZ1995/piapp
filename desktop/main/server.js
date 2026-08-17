/* eslint-disable @typescript-eslint/no-require-imports -- Electron 主进程使用 CommonJS */
"use strict";

const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const http = require("http");
const net = require("net");
const os = require("os");
const path = require("path");

// 首次运行时子进程可能阻塞在系统授权弹窗上（TCC），
// 给用户留足点击「允许」的时间，超时后还有重试对话框兜底。
const READY_TIMEOUT_MS = 300000;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function runForOutput(cmd, args, timeoutMs = 5000) {
  try {
    const r = spawnSync(cmd, args, {
      encoding: "utf8",
      timeout: timeoutMs,
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (r.error || r.status !== 0 || !r.stdout) return null;
    return r.stdout;
  } catch {
    return null;
  }
}

function lastLine(s) {
  const lines = String(s).split("\n").map((l) => l.trim()).filter(Boolean);
  return lines.length ? lines[lines.length - 1] : null;
}

// GUI 应用 PATH 极简（/usr/bin:/bin:...），必须通过登录 shell 拿到用户真实 PATH
function loginShellPath() {
  const out = runForOutput("/bin/zsh", ["-lic", 'printf "%s" "$PATH"'], 6000);
  return out && out.includes("/") ? out : null;
}

function resolveNode(configured) {
  const candidates = [];
  if (configured) candidates.push(configured);
  if (process.env.PI_WEB_NODE) candidates.push(process.env.PI_WEB_NODE);
  const fromShell = runForOutput("/bin/zsh", ["-lic", "command -v node"], 6000);
  if (fromShell) {
    const l = lastLine(fromShell);
    if (l) candidates.push(l);
  }
  const home = os.homedir();
  candidates.push(
    path.join(home, ".local", "bin", "node"),
    "/opt/homebrew/bin/node",
    "/usr/local/bin/node",
    "/usr/bin/node"
  );
  const nvmDir = path.join(home, ".nvm", "versions", "node");
  try {
    const vers = fs
      .readdirSync(nvmDir)
      .filter((d) => /^v\d+/.test(d))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    for (const v of vers) candidates.push(path.join(nvmDir, v, "bin", "node"));
  } catch { /* 无 nvm */ }

  for (const c of candidates) {
    if (!c || !fs.existsSync(c)) continue;
    const v = runForOutput(c, ["--version"], 4000);
    if (v && /v\d+\.\d+/.test(v)) return c;
  }
  return null;
}

function buildChildEnv() {
  const env = { ...process.env };
  const shellPath = loginShellPath();
  const extras = [
    path.join(os.homedir(), ".local", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ];
  const parts = new Set([
    ...(shellPath ? shellPath.split(":") : []),
    ...(env.PATH || "").split(":"),
    ...extras,
  ]);
  env.PATH = [...parts].filter(Boolean).join(":");
  env.PI_WEB_DESKTOP = "1";
  return env;
}

// 返回 'pi-web' | 'other' | 'free'
function probe(port, timeoutMs = 2000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (!done) { done = true; resolve(v); }
    };
    const req = http.get({ host: "127.0.0.1", port, path: "/", timeout: timeoutMs }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c) => { if (body.length < 128 * 1024) body += c; });
      res.on("end", () =>
        // 品牌标记兼容新旧版本：PiPi Agent（现）/ Yasuo Agent / Pi Agent Web（旧）
        finish(res.statusCode === 200 && (body.includes("PiPi Agent") || body.includes("Yasuo Agent") || body.includes("Pi Agent Web")) ? "pi-web" : "other")
      );
      res.on("error", () => finish("other"));
    });
    req.on("timeout", () => { req.destroy(); finish("other"); });
    req.on("error", (e) => finish(e && e.code === "ECONNREFUSED" ? "free" : "other"));
  });
}

function probeDesktopTerminal(port, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port, path: "/api/terminals", timeout: timeoutMs }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { if (body.length < 8192) body += chunk; });
      res.on("end", () => {
        try { resolve(res.statusCode === 200 && JSON.parse(body).enabled === true); }
        catch { resolve(false); }
      });
    });
    req.on("timeout", () => { req.destroy(); resolve(false); });
    req.on("error", () => resolve(false));
  });
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.listen(0, "127.0.0.1", () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
    srv.on("error", reject);
  });
}

async function startServer({ repoPath, nodePath, env, preferredPort, log }) {
  const state = await probe(preferredPort);
  log(`probe(${preferredPort}) = ${state}`);
  if (state === "pi-web" && await probeDesktopTerminal(preferredPort)) {
    log(`端口 ${preferredPort} 已有 PiPi Agent 桌面服务在运行，直接附着`);
    return { mode: "attached", port: preferredPort, pid: null };
  }
  const port = state === "free" ? preferredPort : await findFreePort();
  if (state !== "free") log(`端口 ${preferredPort} 的服务不含桌面终端能力，改用 ${port}`);

  if (!fs.existsSync(path.join(repoPath, ".next"))) {
    throw new Error(`pi-web 尚未构建（缺少 .next 目录）。请在 ${repoPath} 运行 npm run build`);
  }

  // detached: true 使子进程成为进程组组长，之后 kill(-pid) 才能连
  // next-server 孙进程一起杀掉（Phase 0 实测它会孤儿化）
  log(`spawn: ${nodePath} bin/pi-web.js --no-open --hostname 127.0.0.1 --port ${port}（cwd: ${repoPath}）`);
  // 注意：不能用 detached: true——在 LaunchServices(launchd) 上下文中，
  // detached(setsid) 的子进程会静默死亡且 SIGCHLD 丢失（实测踩坑）。
  // 因此退出时改用 ps 枚举子孙进程树逐个 kill（见 killTree）。
  const child = spawn(
    nodePath,
    [path.join(repoPath, "bin", "pi-web.js"), "--no-open", "--hostname", "127.0.0.1", "--port", String(port)],
    { cwd: repoPath, env, detached: false, stdio: ["ignore", "pipe", "pipe"] }
  );
  let exited = false;
  let exitCode = null;
  let spawnError = null;
  child.on("error", (e) => { spawnError = e; log(`spawn error: ${e.message}`); });
  child.on("exit", (c) => { exited = true; exitCode = c; log(`服务进程退出，code=${c}`); });
  child.stdout.on("data", (d) => log(`[server] ${String(d).trimEnd()}`));
  child.stderr.on("data", (d) => log(`[server:err] ${String(d).trimEnd()}`));

  const deadline = Date.now() + READY_TIMEOUT_MS;
  let lastProbeLog = 0;
  while (Date.now() < deadline) {
    if (spawnError) throw new Error(`spawn 失败：${spawnError.message}`);
    if (exited) throw new Error(`pi-web 服务进程提前退出（exit code ${exitCode}）`);
    const s = await probe(port);
    if (s === "pi-web") {
      return { mode: "spawned", port, pid: child.pid };
    }
    if (Date.now() - lastProbeLog > 5000) {
      lastProbeLog = Date.now();
      log(`等待服务就绪… probe=${s}`);
    }
    await sleep(500);
  }
  log("服务就绪超时，清理子进程");
  killTree(child.pid, "SIGTERM");
  throw new Error(`等待 pi-web 服务就绪超时（${READY_TIMEOUT_MS / 1000}s）`);
}

// 用 ps 枚举 <pid> 的全部子孙进程，先杀子孙再杀根。
function descendantPids(rootPid) {
  const out = runForOutput("/bin/ps", ["-axo", "pid=,ppid="], 4000);
  if (!out) return [];
  const childrenOf = new Map();
  for (const line of out.split("\n")) {
    const m = line.trim().match(/^(\d+)\s+(\d+)$/);
    if (!m) continue;
    const pid = Number(m[1]);
    const ppid = Number(m[2]);
    if (!childrenOf.has(ppid)) childrenOf.set(ppid, []);
    childrenOf.get(ppid).push(pid);
  }
  const result = [];
  const queue = [rootPid];
  const seen = new Set([rootPid]);
  while (queue.length) {
    const cur = queue.shift();
    for (const kid of childrenOf.get(cur) || []) {
      if (seen.has(kid)) continue;
      seen.add(kid);
      result.push(kid);
      queue.push(kid);
    }
  }
  return result;
}

function killTree(pid, signal) {
  if (!pid) return;
  const tree = [...descendantPids(pid).reverse(), pid]; // 子孙在前
  for (const p of tree) {
    try { process.kill(p, signal); } catch { /* 已退出 */ }
  }
}

// 只杀自己 spawn 的服务；附着模式不动别人的进程
function stopServer(handle, log) {
  if (!handle || handle.mode !== "spawned" || !handle.pid) return;
  if (log) log(`停止 pi-web 服务进程组（pid ${handle.pid}）`);
  killTree(handle.pid, "SIGTERM");
  const t = setTimeout(() => killTree(handle.pid, "SIGKILL"), 3000);
  if (t.unref) t.unref();
}

module.exports = { startServer, stopServer, resolveNode, buildChildEnv, probe };
