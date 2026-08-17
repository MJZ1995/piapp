/* eslint-disable @typescript-eslint/no-require-imports -- Electron 主进程使用 CommonJS */
"use strict";

// 局域网更新（同事端）：发现更新源 → 配对 → 下载校验 → 原子替换运行时 → 重启。

const fs = require("fs");
const http = require("http");
const path = require("path");
const crypto = require("crypto");
const { app, dialog, BrowserWindow, ipcMain } = require("electron");
const { SERVICE_TYPE } = require("./lan-share");

function browseServices(timeoutMs = 3000) {
  return new Promise((resolve) => {
    let bonjour;
    const found = [];
    try {
      const { Bonjour } = require("bonjour-service");
      bonjour = new Bonjour();
      const browser = bonjour.find({ type: SERVICE_TYPE }, (service) => {
        found.push({
          name: service.name,
          host: (service.addresses || []).find((a) => a.includes(".")) || service.host,
          port: service.port,
          version: (service.txt && service.txt.v) || "",
        });
      });
      setTimeout(() => {
        try { browser.stop(); } catch { /* ignore */ }
        try { bonjour.destroy(); } catch { /* ignore */ }
        resolve(found);
      }, timeoutMs);
    } catch {
      resolve([]);
    }
  });
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: 5000 }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c) => { body += c; });
      res.on("end", () => {
        if (res.statusCode !== 200) return reject(Object.assign(new Error(`HTTP ${res.statusCode}`), { status: res.statusCode }));
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    });
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
    req.on("error", reject);
  });
}

function download(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const req = http.get(url, { timeout: 15000 }, (res) => {
      if (res.statusCode !== 200) { file.close(); return reject(new Error(`HTTP ${res.statusCode}`)); }
      const total = Number(res.headers["content-length"]) || 0;
      let got = 0;
      res.on("data", (c) => { got += c.length; if (total && onProgress) onProgress(got / total); });
      res.pipe(file);
      file.on("finish", () => file.close(resolve));
    });
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
    req.on("error", (e) => { file.close(); reject(e); });
  });
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    fs.createReadStream(file)
      .on("data", (d) => hash.update(d))
      .on("end", () => resolve(hash.digest("hex")))
      .on("error", reject);
  });
}

// 配对码输入窗口（Electron 无原生输入框）
function askPairingCode(parentWindow) {
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 340, height: 180, resizable: false, minimizable: false, maximizable: false,
      title: "输入配对码", parent: parentWindow || undefined, modal: !!parentWindow,
      autoHideMenuBar: true,
      webPreferences: { nodeIntegration: true, contextIsolation: false },
    });
    win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(`<!doctype html><meta charset="utf-8">
      <body style="font-family:-apple-system;margin:0;padding:16px;background:var(--bg,#fff)">
      <div style="font-size:13px;margin-bottom:8px">请输入分享者屏幕上显示的 6 位配对码：</div>
      <input id="c" maxlength="6" autofocus style="width:100%;font-size:20px;letter-spacing:4px;text-align:center;padding:6px;box-sizing:border-box">
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
        <button onclick="require('electron').ipcRenderer.send('pair',null)">取消</button>
        <button id="ok" style="font-weight:600">确定</button>
      </div>
      <script>
        const send=()=>require('electron').ipcRenderer.send('pair',document.getElementById('c').value.trim());
        document.getElementById('ok').onclick=send;
        document.getElementById('c').onkeydown=(e)=>{if(e.key==='Enter')send();};
      </script></body>`));
    ipcMain.once("pair", (_e, code) => { win.close(); resolve(code && /^\d{6}$/.test(code) ? code : null); });
    win.on("closed", () => resolve(null));
  });
}

class LanUpdater {
  constructor({ cfg, log, tray }) {
    this.cfg = cfg;
    this.log = log;
    this.tray = tray;
    this.checking = false;
  }

  runtimeDir() { return path.join(app.getPath("userData"), "runtime"); }

  localVersion() {
    try { return JSON.parse(fs.readFileSync(path.join(this.runtimeDir(), "manifest.json"), "utf8")).version || "0"; }
    catch { return "0"; }
  }

  async run() {
    if (this.checking) return;
    this.checking = true;
    try { await this._run(); }
    catch (e) {
      this.log("局域网更新失败：", (e && e.stack) || e);
      dialog.showErrorBox("局域网更新失败", String((e && e.message) || e));
    } finally {
      this.checking = false;
      if (this.tray) this.tray.rebuildMenu();
    }
  }

  async _run() {
    const services = await browseServices();
    if (services.length === 0) {
      await dialog.showMessageBox({ type: "info", title: "局域网更新", message: "未发现局域网内的更新源", detail: "请确认：① 与分享者连接同一 WiFi；② 对方已在托盘菜单开启「分享局域网更新」。", buttons: ["知道了"] });
      return;
    }

    let service = services[0];
    if (services.length > 1) {
      const r = await dialog.showMessageBox({ type: "question", title: "局域网更新", message: "发现多个更新源，选择其一：", buttons: [...services.map((s) => s.name), "取消"], cancelId: services.length });
      if (r.response >= services.length) return;
      service = services[r.response];
    }

    const base = `http://${service.host}:${service.port}`;
    let code = this.cfg.raw.updatePairingCode || "";
    let manifest;
    try {
      manifest = await fetchJson(`${base}/manifest.json?code=${code}`);
    } catch (e) {
      if (e.status !== 401) throw new Error(`无法连接更新源（${e.message}）`);
      code = await askPairingCode();
      if (!code) return;
      manifest = await fetchJson(`${base}/manifest.json?code=${code}`);
      this.cfg.set({ updatePairingCode: code });
    }

    const local = this.localVersion();
    if (!manifest.version || manifest.version <= local) {
      await dialog.showMessageBox({ type: "info", title: "局域网更新", message: "已是最新版本", detail: `当前版本：${local}`, buttons: ["知道了"] });
      return;
    }

    const r = await dialog.showMessageBox({
      type: "question", title: "发现新版本",
      message: `${service.name} 提供了新版本 ${manifest.version}（当前 ${local}）`,
      detail: "更新只替换内置运行时，会话与配置完全保留。",
      buttons: ["立即更新", "稍后"], defaultId: 0, cancelId: 1,
    });
    if (r.response !== 0) return;

    const tmpDir = path.join(app.getPath("userData"), "update-download");
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });
    const tgz = path.join(tmpDir, "runtime.tar.gz");
    await download(`${base}/runtime.tar.gz?code=${code}`, tgz, (p) => {
      if (this.tray && this.tray.tray) this.tray.tray.setTitle(`${Math.round(p * 100)}%`);
    });
    if (this.tray && this.tray.tray) this.tray.tray.setTitle("");

    const sha = await sha256File(tgz);
    if (manifest.sha256 && sha !== manifest.sha256) throw new Error("下载校验失败（SHA-256 不一致），请重试");

    const staging = `${this.runtimeDir()}.new`;
    const backup = `${this.runtimeDir()}.previous`;
    fs.rmSync(staging, { recursive: true, force: true });
    fs.mkdirSync(staging, { recursive: true });
    const { spawnSync } = require("child_process");
    const untar = spawnSync("/usr/bin/tar", ["-xzf", tgz, "-C", staging, "--strip-components=1"], { timeout: 120000 });
    if (untar.status !== 0) throw new Error(`解压失败：${untar.stderr || untar.status}`);
    try { fs.chmodSync(path.join(staging, "node"), 0o755); } catch { /* ignore */ }
    try { fs.chmodSync(path.join(staging, "pi-web", "node_modules", "node-pty", "build", "Release", "spawn-helper"), 0o755); } catch { /* ignore */ }

    fs.rmSync(backup, { recursive: true, force: true });
    if (fs.existsSync(this.runtimeDir())) fs.renameSync(this.runtimeDir(), backup);
    fs.renameSync(staging, this.runtimeDir());
    fs.rmSync(backup, { recursive: true, force: true });
    fs.rmSync(tmpDir, { recursive: true, force: true });
    this.log(`局域网更新完成：${local} → ${manifest.version}`);

    const done = await dialog.showMessageBox({ type: "info", title: "更新完成", message: `已更新到 ${manifest.version}`, detail: "重启应用后生效。会话与配置均已保留。", buttons: ["立即重启", "稍后"], defaultId: 0, cancelId: 1 });
    if (done.response === 0) { app.relaunch(); app.exit(0); }
  }
}

module.exports = { LanUpdater };
