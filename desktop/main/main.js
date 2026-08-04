/* eslint-disable @typescript-eslint/no-require-imports -- Electron 主进程使用 CommonJS */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { app, dialog, ipcMain, nativeImage } = require("electron");
const { Config, isValidRepo } = require("./config");
const server = require("./server");
const runtime = require("./runtime");
const win = require("./window");
const { installAppMenu } = require("./menu");
const { AppTray } = require("./tray");
const { LanShare } = require("./lan-share");
const { LanUpdater } = require("./lan-update");
const { registerToggleShortcut, unregisterAll } = require("./shortcut");
const { RunningWatcher, notifySessionFinished, playFinishSound } = require("./notify");

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

let serverHandle = null;
let watcher = null;
let tray = null;
let lanShare = null;
let cfg = null;

function createWindowIfReady() {
  if (!serverHandle) return;
  if (win.getWindowCount() > 0) {
    win.showAllWindows();
    return;
  }
  win.createWindow({ url: `http://127.0.0.1:${serverHandle.port}`, port: serverHandle.port });
}

// File > New Window（⌘N）：并行多个项目；服务未就绪时先给启动页窗口
function newWindow() {
  if (serverHandle) {
    win.createWindow({ url: `http://127.0.0.1:${serverHandle.port}`, port: serverHandle.port });
  } else {
    win.createWindow({ url: null });
  }
}

function toggleWindow() {
  if (win.toggleAllWindows() === "need-create") createWindowIfReady();
}

function quitApp() {
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
    if (!win.showAllWindows()) createWindowIfReady();
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

    // 应用菜单（File > New Window ⌘N）
    installAppMenu({ onNewWindow: newWindow });

    // 自包含模式（同事分发）：打包且未配置 repoPath → 使用内置运行时
    const packaged = runtime.resolvePackagedRuntime({ app, cfg, log });

    // 仓库目录：config.json → 默认候选 → 首次启动弹框选择（自包含模式跳过）
    if (!packaged && !cfg.repoPath) {
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
    if (!packaged) log("repo:", cfg.repoPath);

    const nodePath = packaged ? packaged.nodePath : server.resolveNode(cfg.nodePath);
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
    win.createWindow({ url: null, port: cfg.port });

    // 原生目录选择器（供 pi-web 的 Custom path… 调用）
    ipcMain.handle("pi-desktop:select-directory", async () => {
      const w = win.getFocusedWindow();
      const opts = {
        title: "选择项目文件夹",
        buttonLabel: "选择",
        properties: ["openDirectory", "createDirectory"],
      };
      const r = w
        ? await dialog.showOpenDialog(w, opts)
        : await dialog.showOpenDialog(opts);
      return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
    });

    serverHandle = await startServerWithRetry(
      packaged ? { ...cfg, repoPath: packaged.repoPath, port: cfg.port } : cfg,
      nodePath,
    );
    if (!serverHandle) return; // 用户选择退出
    log(`服务就绪：mode=${serverHandle.mode} port=${serverHandle.port}`);

    // 服务就绪：把所有启动页窗口切到真实地址；没有窗口则新建
    const serverUrl = `http://127.0.0.1:${serverHandle.port}`;
    const all = win.getAllWindows();
    const loading = all.filter((w) => w.__loading);
    if (loading.length > 0) {
      for (const w of loading) {
        w.__loading = false;
        w.loadURL(serverUrl);
      }
    } else if (all.length > 0) {
      all[0].loadURL(serverUrl);
    } else {
      win.createWindow({ url: serverUrl, port: serverHandle.port });
    }

    // 局域网更新：发布端（有 repoPath 的开发机）可分享；同事端可检查更新
    const updateDir = cfg.repoPath ? path.join(cfg.repoPath, "desktop", "update") : null;
    if (updateDir) lanShare = new LanShare({ updateDir, log });
    const lanUpdater = new LanUpdater({ cfg, log, tray: null });

    tray = new AppTray({
      iconPath: path.join(__dirname, "..", "assets", "tray.png"),
      onToggleWindow: toggleWindow,
      onQuit: quitApp,
      onShareToggle: lanShare ? async () => {
        if (lanShare.sharing) {
          lanShare.stop();
          tray.setShareState({ sharing: false, code: null });
        } else {
          try {
            const { code } = await lanShare.start();
            const m = lanShare.manifest();
            tray.setShareState({ sharing: true, code, version: m && m.version });
            dialog.showMessageBox({ type: "info", title: "局域网更新分享", message: "更新分享已开启", detail: `版本：${(m && m.version) || "未知"}\n配对码：${code}\n\n请同事在其托盘菜单点击「检查局域网更新…」，并输入此配对码。`, buttons: ["好"] });
          } catch (e) {
            dialog.showErrorBox("无法开启分享", String((e && e.message) || e));
          }
        }
      } : null,
      onCheckUpdate: () => { void lanUpdater.run(); },
      log,
    });
    lanUpdater.tray = tray;

    // PI_WEB_LAN_SHARE_AUTO=1：启动即自动开启更新分享（托盘可手动关）
    if (lanShare && process.env.PI_WEB_LAN_SHARE_AUTO === "1") {
      lanShare.start()
        .then(({ code }) => {
          const m = lanShare.manifest();
          tray.setShareState({ sharing: true, code, version: m && m.version });
          log(`自动开启更新分享，配对码=${code}`);
        })
        .catch((e) => log("自动分享失败：", (e && e.message) || e));
    }

    registerToggleShortcut(cfg.shortcut, toggleWindow, log);

    watcher = new RunningWatcher({
      port: serverHandle.port,
      log,
      onChange: (count) => { if (tray) tray.setRunningCount(count); },
      onSessionFinished: (sessionId) => {
        playFinishSound(); // 音效每次完成都播（彩蛋）；系统通知仅在窗口未聚焦时弹
        if (win.anyWindowFocused()) return;
        notifySessionFinished({
          title: "Yasuo Agent",
          body: "回复完成，点击查看会话",
          onClick: () => {
            if (!win.showAllWindows()) createWindowIfReady();
            const w2 = win.getFocusedWindow();
            if (w2) {
              w2.__loading = false;
              w2.loadURL(`http://127.0.0.1:${serverHandle.port}/?session=${encodeURIComponent(sessionId)}`);
            }
          },
        });
      },
    });
    watcher.start();

    app.on("activate", () => {
      if (!win.showAllWindows()) createWindowIfReady();
    });
  });

  // macOS 惯例：关窗不退出，由托盘菜单或 Cmd+Q 退出
  app.on("window-all-closed", () => {});

  app.on("before-quit", () => {
    if (watcher) watcher.stop();
    if (lanShare && lanShare.sharing) lanShare.stop();
    server.stopServer(serverHandle, log);
  });

  app.on("will-quit", () => unregisterAll());

  // 最后一道兜底：进程退出时同步杀进程组（SIGTERM 对 node 默认即终止）
  process.on("exit", () => server.stopServer(serverHandle, null));
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(sig, () => quitApp());
  }
}
