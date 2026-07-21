"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { app, dialog, nativeImage } = require("electron");
const { Config, isValidRepo } = require("./config");
const server = require("./server");
const win = require("./window");
const { AppTray } = require("./tray");
const { registerToggleShortcut, unregisterAll } = require("./shortcut");
const { RunningWatcher, notifySessionFinished } = require("./notify");

// 打包后 stdout 不可见，日志同时写文件：~/Library/Application Support/pi-web-desktop/desktop.log
let logFile = null;
const log = (...a) => {
  const line = [new Date().toISOString(), "[pi-web-desktop]", ...a].join(" ");
  try { console.log(line); } catch { /* ignore */ }
  try {
    if (!logFile) {
      const dir = app.isReady()
        ? app.getPath("userData")
        : path.join(os.homedir(), "Library", "Application Support", "pi-web-desktop");
      fs.mkdirSync(dir, { recursive: true });
      logFile = path.join(dir, "desktop.log");
    }
    fs.appendFileSync(logFile, line + "\n");
  } catch { /* 日志失败不影响运行 */ }
};
process.on("uncaughtException", (e) => log("uncaughtException:", e && e.stack || e));
process.on("unhandledRejection", (e) => log("unhandledRejection:", e && e.stack || e));

app.isQuitting = false;

let serverHandle = null;
let watcher = null;
let tray = null;
let cfg = null;

function createWindowIfReady() {
  if (!serverHandle) return;
  if (win.getMainWindow()) {
    win.showMainWindow();
    return;
  }
  win.createMainWindow({ url: `http://127.0.0.1:${serverHandle.port}`, port: serverHandle.port });
}

function toggleWindow() {
  if (win.toggleMainWindow() === "need-create") createWindowIfReady();
}

function quitApp() {
  app.isQuitting = true;
  app.quit();
}

// 启动失败时用异步对话框给“重试/退出”选择。
// 注意：不能用同步模态框 + app.quit()——模态会话会延迟退出，
// 进程变僵尸还占着单实例锁（本次排查实测踩坑）。
async function startServerWithRetry(cfg, nodePath) {
  for (;;) {
    try {
      return await server.startServer({
        repoPath: cfg.repoPath,
        nodePath,
        env: server.buildChildEnv(),
        preferredPort: cfg.port,
        log,
      });
    } catch (e) {
      log("服务启动失败：", (e && e.stack) || e);
      const r = await dialog.showMessageBox({
        type: "error",
        title: "pi-web 服务启动失败",
        message: String((e && e.message) || e),
        detail: "如果是权限问题，请先在系统设置中授权后点击“重试”。\n日志见 ~/Library/Application Support/pi-web-desktop/desktop.log",
        buttons: ["重试", "退出"],
        defaultId: 0,
        cancelId: 1,
      });
      if (r.response === 1) app.exit(1);
    }
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!win.showMainWindow()) createWindowIfReady();
  });

  app.whenReady().then(async () => {
    log("app ready, single instance lock acquired");
    // Dock 图标（开发期生效；打包后由 icns 提供）
    try {
      const img = nativeImage.createFromPath(path.join(__dirname, "..", "assets", "icon.png"));
      if (!img.isEmpty() && app.dock) app.dock.setIcon(img);
    } catch { /* 图标缺失不影响运行 */ }

    cfg = new Config(app, log);
    log("config:", JSON.stringify({ file: cfg.file, port: cfg.port, shortcut: cfg.shortcut, nodePath: cfg.nodePath, repoPath: cfg.repoPath }));

    // 仓库目录：config.json → 默认候选 → 首次启动弹框选择
    if (!cfg.repoPath) {
      const picked = await dialog.showOpenDialog({
        title: "请选择 pi-web 仓库目录（包含 bin/pi-web.js）",
        properties: ["openDirectory"],
      });
      const dir = picked.canceled ? null : picked.filePaths[0];
      if (!dir || !isValidRepo(dir)) {
        dialog.showErrorBox("未找到 pi-web", "未选择有效的 pi-web 仓库目录（需要包含 bin/pi-web.js）。");
        app.quit();
        return;
      }
      cfg.set({ repoPath: dir });
    }
    log("repo:", cfg.repoPath);

    const nodePath = server.resolveNode(cfg.nodePath);
    if (!nodePath) {
      dialog.showErrorBox(
        "找不到 Node.js",
        `未找到可用的 node。请在 ${cfg.file} 中设置 "nodePath"，或安装 Node.js。`
      );
      app.quit();
      return;
    }
    log("node:", nodePath);

    // 先开启动页窗口：首次运行等待系统授权期间用户有明确反馈
    win.createMainWindow({ url: null, port: cfg.port });

    serverHandle = await startServerWithRetry(cfg, nodePath);
    if (!serverHandle) return; // 用户选择退出
    log(`服务就绪：mode=${serverHandle.mode} port=${serverHandle.port}`);

    const w = win.getMainWindow();
    if (w) w.loadURL(`http://127.0.0.1:${serverHandle.port}`);
    else win.createMainWindow({ url: `http://127.0.0.1:${serverHandle.port}`, port: serverHandle.port });

    tray = new AppTray({
      iconPath: path.join(__dirname, "..", "assets", "tray.png"),
      onToggleWindow: toggleWindow,
      onQuit: quitApp,
      log,
    });

    registerToggleShortcut(cfg.shortcut, toggleWindow, log);

    watcher = new RunningWatcher({
      port: serverHandle.port,
      log,
      onChange: (count) => { if (tray) tray.setRunningCount(count); },
      onSessionFinished: (sessionId) => {
        const w = win.getMainWindow();
        const focused = w && w.isVisible() && w.isFocused();
        if (focused) return; // 用户正盯着窗口，不打扰
        notifySessionFinished({
          title: "Pi 回复完成",
          body: "点击查看会话",
          onClick: () => {
            if (!win.showMainWindow()) createWindowIfReady();
            const w2 = win.getMainWindow();
            if (w2) {
              w2.loadURL(`http://127.0.0.1:${serverHandle.port}/?session=${encodeURIComponent(sessionId)}`);
            }
          },
        });
      },
    });
    watcher.start();

    app.on("activate", () => {
      if (!win.showMainWindow()) createWindowIfReady();
    });
  });

  // macOS 惯例：关窗不退出，由托盘菜单或 Cmd+Q 退出
  app.on("window-all-closed", () => {});

  app.on("before-quit", () => {
    app.isQuitting = true;
    if (watcher) watcher.stop();
    server.stopServer(serverHandle, log);
  });

  app.on("will-quit", () => unregisterAll());

  // 最后一道兜底：进程退出时同步杀进程组（SIGTERM 对 node 默认即终止）
  process.on("exit", () => server.stopServer(serverHandle, null));
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(sig, () => quitApp());
  }
}
