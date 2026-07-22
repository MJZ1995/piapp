/* eslint-disable @typescript-eslint/no-require-imports -- Electron 主进程使用 CommonJS */
"use strict";

const { app, Menu } = require("electron");

// macOS 应用菜单：在系统默认菜单结构基础上，File 增加 New Window（⌘N）。
// Close Window（⌘W，role:close）只关闭当前聚焦窗口；
// 全部窗口关闭后应用仍驻留，可经 Dock / 托盘 / 全局快捷键 / New Window 重建。
function installAppMenu({ onNewWindow }) {
  const template = [
    {
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "File",
      submenu: [
        { label: "New Window", accelerator: "CmdOrCtrl+N", click: () => onNewWindow() },
        { type: "separator" },
        { role: "close" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "pasteAndMatchStyle" },
        { role: "delete" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Window",
      role: "windowMenu",
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

module.exports = { installAppMenu };
