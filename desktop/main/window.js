"use strict";

const path = require("path");
const { app, BrowserWindow, shell } = require("electron");

let mainWindow = null;

// 服务就绪前的启动页（首次运行等待系统权限授权时给用户明确指引）
const LOADING_HTML = `data:text/html;charset=utf-8,${encodeURIComponent(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Yasuo Agent</title></head>
<body style="margin:0;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#1e1e1e;color:#ccc;font-family:-apple-system,'PingFang SC',sans-serif;user-select:none">
  <div style="font-size:22px;font-weight:600;margin-bottom:16px">Yasuo Agent</div>
  <div style="font-size:13px;color:#999">正在启动本地服务…</div>
  <div style="font-size:12px;color:#777;margin-top:28px;max-width:360px;text-align:center;line-height:2">
    首次运行如看到系统弹窗「"Yasuo Agent"想访问"桌面"文件夹中的文件」<br>
    请点击「允许」，授权后会自动继续
  </div>
</body></html>`)}`;

function isOurUrl(u, port) {
  return u.startsWith(`http://127.0.0.1:${port}`) || u.startsWith(`http://localhost:${port}`);
}

// url 为空时显示启动页
function createMainWindow({ url, port }) {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: "Yasuo Agent",
    backgroundColor: "#1e1e1e",
    webPreferences: {
      preload: path.join(__dirname, "..", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  mainWindow = win;

  // 外部链接交给系统浏览器；本服务链接允许开新窗口
  win.webContents.setWindowOpenHandler(({ url: u }) => {
    if (isOurUrl(u, port)) return { action: "allow" };
    shell.openExternal(u);
    return { action: "deny" };
  });

  // 关闭 = 隐藏（agent 长跑任务不中断）；Cmd+Q 才真正退出
  win.on("close", (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      win.hide();
    }
  });
  win.on("closed", () => { if (mainWindow === win) mainWindow = null; });

  win.loadURL(url || LOADING_HTML);
  return win;
}

function showMainWindow() {
  if (!mainWindow) return false;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  return true;
}

function hideMainWindow() {
  if (mainWindow) mainWindow.hide();
}

// 返回 'need-create' 表示没有窗口，调用方应重建
function toggleMainWindow() {
  if (!mainWindow) return "need-create";
  if (mainWindow.isVisible() && mainWindow.isFocused()) hideMainWindow();
  else showMainWindow();
  return "toggled";
}

function getMainWindow() {
  return mainWindow;
}

module.exports = { createMainWindow, showMainWindow, hideMainWindow, toggleMainWindow, getMainWindow };
