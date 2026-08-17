/* eslint-disable @typescript-eslint/no-require-imports -- Electron 主进程使用 CommonJS */
"use strict";

const path = require("path");
const { app, BrowserWindow, shell } = require("electron");

// 多窗口管理：所有窗口共享同一个 pi-web 后端服务，关窗不会中断 agent 任务
const windows = new Set();
let lastFocused = null;
let currentPort = null;

// 服务就绪前的启动页（首次运行等待系统权限授权时给用户明确指引）
const LOADING_HTML = `data:text/html;charset=utf-8,${encodeURIComponent(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>PiPi Agent</title></head>
<body style="margin:0;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#1e1e1e;color:#ccc;font-family:-apple-system,'PingFang SC',sans-serif;user-select:none">
  <div style="font-size:22px;font-weight:600;margin-bottom:16px">PiPi Agent</div>
  <div style="font-size:13px;color:#999">正在启动本地服务…</div>
  <div style="font-size:12px;color:#777;margin-top:28px;max-width:360px;text-align:center;line-height:2">
    首次运行如看到系统弹窗「"PiPi Agent"想访问"桌面"文件夹中的文件」<br>
    请点击「允许」，授权后会自动继续
  </div>
</body></html>`)}`;

function isOurUrl(u, port) {
  return u.startsWith(`http://127.0.0.1:${port}`) || u.startsWith(`http://localhost:${port}`);
}

function trackWindow(w) {
  if (windows.has(w)) return;
  windows.add(w);
  w.on("focus", () => { lastFocused = w; });
  w.on("closed", () => {
    windows.delete(w);
    if (lastFocused === w) lastFocused = null;
  });
}

// 外部链接交给系统浏览器；本服务链接允许开新窗口
function applyOpenHandler(w) {
  w.webContents.setWindowOpenHandler(({ url: u }) => {
    if (currentPort && isOurUrl(u, currentPort)) return { action: "allow" };
    shell.openExternal(u);
    return { action: "deny" };
  });
}

// 渲染进程 window.open 创建的窗口不经过 createWindow，统一纳管（独立 DevTools 窗口除外）
app.on("browser-window-created", (_e, w) => {
  if (w.webContents.getType() !== "window") return;
  trackWindow(w);
  applyOpenHandler(w);
});

// url 为空时显示启动页；__loading 标记用于服务就绪后统一加载真实地址
function createWindow({ url, port } = {}) {
  if (port) currentPort = port;
  const w = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: "PiPi Agent",
    backgroundColor: "#1e1e1e",
    webPreferences: {
      preload: path.join(__dirname, "..", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  trackWindow(w);
  applyOpenHandler(w);
  w.__loading = !url;
  w.loadURL(url || LOADING_HTML);
  return w;
}

function getAllWindows() {
  return [...windows];
}

function getWindowCount() {
  return windows.size;
}

// 当前聚焦窗口；无聚焦时回退到最近聚焦的窗口（供目录选择器、通知跳转挂载）
function getFocusedWindow() {
  const w = BrowserWindow.getFocusedWindow();
  if (w && windows.has(w)) return w;
  if (lastFocused && !lastFocused.isDestroyed()) return lastFocused;
  return [...windows][0] || null;
}

// 是否有我们的窗口正处于聚焦状态（用于通知的"用户正盯着就不打扰"判断）
function anyWindowFocused() {
  const w = BrowserWindow.getFocusedWindow();
  return !!w && windows.has(w);
}

function showAllWindows() {
  if (windows.size === 0) return false;
  for (const w of windows) {
    if (w.isMinimized()) w.restore();
    w.show();
  }
  const f = getFocusedWindow();
  if (f) f.focus();
  return true;
}

function hideAllWindows() {
  for (const w of windows) w.hide();
}

function anyWindowVisible() {
  for (const w of windows) if (w.isVisible()) return true;
  return false;
}

// 返回 'need-create' 表示没有窗口，调用方应重建
function toggleAllWindows() {
  if (windows.size === 0) return "need-create";
  if (anyWindowVisible()) hideAllWindows();
  else showAllWindows();
  return "toggled";
}

module.exports = {
  createWindow,
  getAllWindows,
  getWindowCount,
  getFocusedWindow,
  anyWindowFocused,
  showAllWindows,
  hideAllWindows,
  toggleAllWindows,
};
