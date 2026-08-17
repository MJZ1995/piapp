/* eslint-disable @typescript-eslint/no-require-imports -- Electron 主进程使用 CommonJS */
"use strict";

// 局域网更新分享（发布端）：HTTP 服务 + Bonjour 广播。
// 同事端通过配对码访问 manifest 与运行时压缩包。

const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const SERVICE_TYPE = "yasuo-update";

class LanShare {
  constructor({ updateDir, log }) {
    this.updateDir = updateDir;
    this.log = log;
    this.server = null;
    this.bonjour = null;
    this.published = null;
    this.code = null;
    this.port = null;
  }

  get sharing() { return this.server !== null; }

  manifest() {
    try { return JSON.parse(fs.readFileSync(path.join(this.updateDir, "manifest.json"), "utf8")); }
    catch { return null; }
  }

  start(port = 39393) {
    if (this.server) return { port: this.port, code: this.code };
    const m = this.manifest();
    if (!m) throw new Error("尚未生成更新包，请先运行 desktop/scripts/pack-runtime.sh");
    this.code = String(Math.floor(100000 + Math.random() * 900000));

    this.server = http.createServer((req, res) => {
      const url = new URL(req.url, "http://x");
      const authed = url.searchParams.get("code") === this.code;
      if (!authed) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "pairing required" }));
        return;
      }
      if (url.pathname === "/manifest.json") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(fs.readFileSync(path.join(this.updateDir, "manifest.json")));
        return;
      }
      if (url.pathname === "/runtime.tar.gz") {
        const file = path.join(this.updateDir, "runtime.tar.gz");
        res.writeHead(200, { "Content-Type": "application/gzip", "Content-Length": fs.statSync(file).size });
        fs.createReadStream(file).pipe(res);
        return;
      }
      res.writeHead(404); res.end();
    });

    return new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(port, "0.0.0.0", () => {
        this.port = port;
        try {
          const { Bonjour } = require("bonjour-service");
          this.bonjour = new Bonjour();
          const version = (this.manifest() || {}).version || "";
          this.published = this.bonjour.publish({
            name: `PiPi Agent @ ${os.hostname().replace(/\.local$/, "")}`,
            type: SERVICE_TYPE,
            port,
            txt: { v: version },
          });
        } catch (e) {
          this.log("Bonjour 广播失败（不影响直连）：", (e && e.message) || e);
        }
        this.log(`局域网更新分享已开启：port=${port} 配对码=${this.code}`);
        resolve({ port: this.port, code: this.code });
      });
    });
  }

  stop() {
    try { if (this.published) this.published.stop(); } catch { /* ignore */ }
    try { if (this.bonjour) this.bonjour.destroy(); } catch { /* ignore */ }
    try { if (this.server) this.server.close(); } catch { /* ignore */ }
    this.server = null; this.bonjour = null; this.published = null; this.port = null; this.code = null;
    this.log("局域网更新分享已关闭");
  }
}

module.exports = { LanShare, SERVICE_TYPE };
