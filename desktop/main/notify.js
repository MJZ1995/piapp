"use strict";

const http = require("http");
const { Notification } = require("electron");

// 订阅 pi-web 自带的 /api/agent/running/events（SSE），
// 当某个会话 id 从"运行中"集合消失时触发 onSessionFinished。
// 零侵入：不需要改 pi-web 任何代码。
class RunningWatcher {
  constructor({ port, log, onSessionFinished, onChange }) {
    this.port = port;
    this.log = log;
    this.onSessionFinished = onSessionFinished;
    this.onChange = onChange || (() => {});
    this.running = new Set();
    this.req = null;
    this.stopped = false;
    this.retry = 0;
  }

  start() {
    this.stopped = false;
    this.connect();
  }

  stop() {
    this.stopped = true;
    if (this.req) {
      try { this.req.destroy(); } catch { /* 忽略 */ }
      this.req = null;
    }
  }

  connect() {
    if (this.stopped) return;
    const req = http.get(
      { host: "127.0.0.1", port: this.port, path: "/api/agent/running/events", headers: { Accept: "text/event-stream" } },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          this.scheduleReconnect();
          return;
        }
        this.retry = 0;
        let buf = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          buf += chunk;
          let i;
          while ((i = buf.indexOf("\n\n")) >= 0) {
            this.handleFrame(buf.slice(0, i));
            buf = buf.slice(i + 2);
          }
        });
        res.on("end", () => this.scheduleReconnect());
        res.on("error", () => this.scheduleReconnect());
      }
    );
    req.on("error", () => this.scheduleReconnect());
    this.req = req;
  }

  scheduleReconnect() {
    if (this.stopped) return;
    const delay = Math.min(15000, 1000 * 2 ** this.retry++);
    const t = setTimeout(() => this.connect(), delay);
    if (t.unref) t.unref();
  }

  handleFrame(frame) {
    const dataLines = frame.split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trim());
    for (const d of dataLines) {
      let msg;
      try { msg = JSON.parse(d); } catch { continue; }
      if (msg && msg.type === "running" && Array.isArray(msg.runningSessionIds)) {
        this.update(new Set(msg.runningSessionIds));
      }
    }
  }

  update(next) {
    const finished = [];
    for (const id of this.running) {
      if (!next.has(id)) finished.push(id);
    }
    this.running = next;
    this.onChange(next.size);
    for (const id of finished) {
      try { this.onSessionFinished(id); } catch { /* 通知失败不影响主流程 */ }
    }
  }
}

function notifySessionFinished({ title, body, onClick }) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, silent: false });
  if (onClick) n.on("click", onClick);
  n.show();
}

module.exports = { RunningWatcher, notifySessionFinished };
