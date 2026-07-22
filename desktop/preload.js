/* eslint-disable @typescript-eslint/no-require-imports -- Electron 主进程使用 CommonJS */
"use strict";

const { contextBridge, ipcRenderer } = require("electron");

// 桌面能力桥（pi-web 前端通过 window.piDesktop 调用，见 SessionSidebar.tsx）
contextBridge.exposeInMainWorld("piDesktop", {
  isDesktop: true,
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
  },
  // 原生目录选择器（Custom path… 入口）
  selectDirectory: () => ipcRenderer.invoke("pi-desktop:select-directory"),
});
