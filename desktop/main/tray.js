/* eslint-disable @typescript-eslint/no-require-imports -- Electron 主进程使用 CommonJS */
"use strict";

const { app, Menu, Tray, nativeImage } = require("electron");

class AppTray {
  constructor({ iconPath, onToggleWindow, onQuit, onShareToggle, onCheckUpdate, log }) {
    this.log = log;
    this.onToggleWindow = onToggleWindow;
    this.onQuit = onQuit;
    this.onShareToggle = onShareToggle || null;
    this.onCheckUpdate = onCheckUpdate || null;
    this.shareInfo = { sharing: false, code: null, version: null };
    this.runningCount = 0;

    let image = nativeImage.createFromPath(iconPath);
    if (image.isEmpty()) {
      log("托盘图标加载失败，跳过托盘");
      this.tray = null;
      return;
    }
    image = image.resize({ width: 18, height: 18 });
    this.tray = new Tray(image);
    this.tray.setToolTip("Yasuo Agent");
    this.tray.on("click", () => this.onToggleWindow());
    this.rebuildMenu();
  }

  setRunningCount(n) {
    if (!this.tray || this.runningCount === n) return;
    this.runningCount = n;
    this.rebuildMenu();
  }

  setShareState(info) {
    this.shareInfo = { ...this.shareInfo, ...info };
    this.rebuildMenu();
  }

  rebuildMenu() {
    if (!this.tray) return;
    const launchAtLogin = app.getLoginItemSettings().openAtLogin;
    const template = [
      { label: "显示 / 隐藏 Yasuo Agent", click: () => this.onToggleWindow() },
      { label: `运行中的会话：${this.runningCount}`, enabled: false },
      { type: "separator" },
    ];
    if (this.onShareToggle) {
      template.push({
        label: this.shareInfo.sharing ? `关闭更新分享（配对码 ${this.shareInfo.code}）` : "分享局域网更新…",
        click: () => this.onShareToggle(),
      });
    }
    if (this.onCheckUpdate) {
      template.push({ label: "检查局域网更新…", click: () => this.onCheckUpdate() });
    }
    template.push(
      { type: "separator" },
      {
        label: "开机自动启动",
        type: "checkbox",
        checked: launchAtLogin,
        click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }),
      },
      { type: "separator" },
      { label: "退出 Yasuo Agent", click: () => this.onQuit() },
    );
    const menu = Menu.buildFromTemplate(template);
    this.tray.setContextMenu(menu);
  }
}

module.exports = { AppTray };
