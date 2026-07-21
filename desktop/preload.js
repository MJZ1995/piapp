"use strict";

const { contextBridge } = require("electron");

// 预留桌面能力桥（当前仅标识运行环境，后续可扩展：
// 在 Finder 中显示文件、原生通知测试等，全部走 [desktop] 提交，不碰上游）
contextBridge.exposeInMainWorld("piDesktop", {
  isDesktop: true,
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
  },
});
