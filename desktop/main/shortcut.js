"use strict";

const { globalShortcut } = require("electron");

function registerToggleShortcut(accelerator, onToggle, log) {
  if (!accelerator) return false;
  try {
    const ok = globalShortcut.register(accelerator, onToggle);
    if (!ok) {
      log(`全局快捷键 ${accelerator} 注册失败（可能被其他应用占用），可在 config.json 修改 "shortcut"`);
    } else {
      log(`全局快捷键已注册：${accelerator}`);
    }
    return ok;
  } catch (e) {
    log(`全局快捷键注册异常：${e.message}`);
    return false;
  }
}

function unregisterAll() {
  try { globalShortcut.unregisterAll(); } catch { /* app 已退出 */ }
}

module.exports = { registerToggleShortcut, unregisterAll };
