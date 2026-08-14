"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Terminal as XtermTerminal } from "@xterm/xterm";
import type { SearchAddon } from "@xterm/addon-search";
import type { FitAddon } from "@xterm/addon-fit";
import type { TerminalInfo } from "@/lib/terminal-manager";

interface Props {
  cwd: string | null;
  isDark: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEnabledChange: (enabled: boolean) => void;
}

interface TerminalViewHandle {
  findNext: (query: string) => boolean;
  findPrevious: (query: string) => boolean;
  exportText: () => string;
  focus: () => void;
}

async function terminalRequest<T>(cwd: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch("/api/terminals", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cwd, ...body }),
  });
  const data = await response.json().catch(() => ({})) as T & { error?: string; busy?: boolean };
  if (!response.ok) {
    const error = new Error(data.error ?? `Terminal request failed (HTTP ${response.status})`) as Error & { status?: number; busy?: boolean };
    error.status = response.status;
    error.busy = data.busy;
    throw error;
  }
  return data;
}

const TerminalView = forwardRef<TerminalViewHandle, {
  terminal: TerminalInfo;
  cwd: string;
  isDark: boolean;
  onRefresh: () => void;
  onError: (message: string) => void;
  onRequestSearch: () => void;
}>(function TerminalView({ terminal, cwd, isDark, onRefresh, onError, onRequestSearch }, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<XtermTerminal | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  useImperativeHandle(ref, () => ({
    findNext(query) { return query ? searchRef.current?.findNext(query) ?? false : false; },
    findPrevious(query) { return query ? searchRef.current?.findPrevious(query) ?? false : false; },
    exportText() {
      const xterm = terminalRef.current;
      if (!xterm) return "";
      const lines: string[] = [];
      for (let index = 0; index < xterm.buffer.active.length; index += 1) {
        lines.push(xterm.buffer.active.getLine(index)?.translateToString(true) ?? "");
      }
      while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
      return lines.join("\n");
    },
    focus() { terminalRef.current?.focus(); },
  }), []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;
    let eventSource: EventSource | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let inputTimer: ReturnType<typeof setTimeout> | null = null;
    let pendingInput = "";
    let writeQueue = Promise.resolve();
    const disposables: Array<{ dispose: () => void }> = [];

    void Promise.all([
      import("@xterm/xterm"),
      import("@xterm/addon-fit"),
      import("@xterm/addon-search"),
    ]).then(([xtermModule, fitModule, searchModule]) => {
      if (cancelled) return;
      const styles = getComputedStyle(document.documentElement);
      const xterm = new xtermModule.Terminal({
        allowProposedApi: true,
        cols: 100,
        rows: 28,
        cursorBlink: true,
        fontFamily: styles.getPropertyValue("--font-mono").trim() || "SFMono-Regular, Menlo, monospace",
        fontSize: 12.5,
        lineHeight: 1.18,
        macOptionIsMeta: true,
        scrollback: 10_000,
        theme: {
          background: styles.getPropertyValue("--bg").trim(),
          foreground: styles.getPropertyValue("--text").trim(),
          cursor: styles.getPropertyValue("--accent").trim(),
          selectionBackground: isDark ? "#164e63" : "#bae6fd",
          black: "#111827",
          red: "#f87171",
          green: "#4ade80",
          yellow: "#facc15",
          blue: "#60a5fa",
          magenta: "#c084fc",
          cyan: "#22d3ee",
          white: "#e5e7eb",
          brightBlack: "#6b7280",
          brightRed: "#fca5a5",
          brightGreen: "#86efac",
          brightYellow: "#fde047",
          brightBlue: "#93c5fd",
          brightMagenta: "#d8b4fe",
          brightCyan: "#67e8f9",
          brightWhite: "#f9fafb",
        },
      });
      const fit = new fitModule.FitAddon();
      const search = new searchModule.SearchAddon();
      xterm.loadAddon(fit);
      xterm.loadAddon(search);
      xterm.open(container);
      terminalRef.current = xterm;
      fitRef.current = fit;
      searchRef.current = search;

      const flushInput = () => {
        inputTimer = null;
        const data = pendingInput;
        pendingInput = "";
        if (!data) return;
        writeQueue = writeQueue
          .then(async () => { await terminalRequest(cwd, { action: "write", id: terminal.id, data }); })
          .catch((error) => onError(error instanceof Error ? error.message : String(error)));
      };

      disposables.push(xterm.onData((data) => {
        pendingInput += data;
        if (inputTimer) clearTimeout(inputTimer);
        inputTimer = setTimeout(flushInput, 8);
      }));
      xterm.attachCustomKeyEventHandler((event) => {
        if (event.type !== "keydown" || !event.metaKey) return true;
        const key = event.key.toLowerCase();
        if (key === "c" && xterm.hasSelection()) {
          void navigator.clipboard.writeText(xterm.getSelection());
          return false;
        }
        if (key === "v") {
          void navigator.clipboard.readText().then((text) => xterm.paste(text));
          return false;
        }
        if (key === "f") {
          onRequestSearch();
          return false;
        }
        return true;
      });

      let lastSize = "";
      const resize = () => {
        try { fit.fit(); } catch { return; }
        const size = `${xterm.cols}x${xterm.rows}`;
        if (size === lastSize) return;
        lastSize = size;
        void terminalRequest(cwd, { action: "resize", id: terminal.id, cols: xterm.cols, rows: xterm.rows }).catch(() => {});
      };
      resizeObserver = new ResizeObserver(() => requestAnimationFrame(resize));
      resizeObserver.observe(container);
      requestAnimationFrame(resize);

      const setFocus = (focused: boolean) => {
        void terminalRequest(cwd, { action: "focus", id: terminal.id, focused }).catch(() => {});
      };
      const onFocusIn = () => setFocus(true);
      const onFocusOut = (event: FocusEvent) => {
        if (!container.contains(event.relatedTarget as Node | null)) setFocus(false);
      };
      container.addEventListener("focusin", onFocusIn);
      container.addEventListener("focusout", onFocusOut);
      disposables.push({ dispose: () => {
        container.removeEventListener("focusin", onFocusIn);
        container.removeEventListener("focusout", onFocusOut);
      } });

      eventSource = new EventSource(`/api/terminals/events?id=${encodeURIComponent(terminal.id)}&cwd=${encodeURIComponent(cwd)}`);
      eventSource.addEventListener("snapshot", (event) => {
        const payload = JSON.parse((event as MessageEvent).data) as { data?: string };
        if (payload.data) xterm.write(payload.data);
      });
      eventSource.addEventListener("data", (event) => {
        const payload = JSON.parse((event as MessageEvent).data) as { data?: string };
        if (payload.data) xterm.write(payload.data);
      });
      eventSource.addEventListener("exit", onRefresh);
      eventSource.addEventListener("meta", onRefresh);
      eventSource.onerror = () => {
        if (!cancelled) onError("终端连接中断，正在重连…");
      };
      xterm.focus();
    }).catch((error) => onError(error instanceof Error ? error.message : String(error)));

    return () => {
      cancelled = true;
      if (inputTimer) clearTimeout(inputTimer);
      if (pendingInput) {
        void terminalRequest(cwd, { action: "write", id: terminal.id, data: pendingInput }).catch(() => {});
      }
      eventSource?.close();
      resizeObserver?.disconnect();
      disposables.forEach((item) => item.dispose());
      terminalRef.current?.dispose();
      terminalRef.current = null;
      searchRef.current = null;
      fitRef.current = null;
      void terminalRequest(cwd, { action: "focus", id: terminal.id, focused: false }).catch(() => {});
    };
  }, [cwd, isDark, onError, onRefresh, onRequestSearch, terminal.id]);

  return <div ref={containerRef} style={{ width: "100%", height: "100%", padding: "6px 8px", background: "var(--bg)", overflow: "hidden" }} />;
});

export function TerminalPanel({ cwd, isDark, open, onOpenChange, onEnabledChange }: Props) {
  const [enabled, setEnabled] = useState(false);
  const [terminals, setTerminals] = useState<TerminalInfo[]>([]);
  const [maximized, setMaximized] = useState(false);
  const [height, setHeight] = useState(300);
  const [searchOpen, setSearchOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const viewRef = useRef<TerminalViewHandle>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    if (!cwd) return;
    try {
      const response = await fetch(`/api/terminals?cwd=${encodeURIComponent(cwd)}`, { cache: "no-store" });
      const data = await response.json() as { enabled?: boolean; terminals?: TerminalInfo[]; error?: string };
      if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
      const available = data.enabled === true;
      setEnabled(available);
      onEnabledChange(available);
      setTerminals(data.terminals ?? []);
    } catch {
      setEnabled(false);
      onEnabledChange(false);
      setTerminals([]);
    }
  }, [cwd, onEnabledChange]);

  useEffect(() => {
    if (!cwd) {
      setEnabled(false);
      onEnabledChange(false);
      setTerminals([]);
      return;
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 2000);
    return () => clearInterval(timer);
  }, [cwd, onEnabledChange, refresh]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (enabled && event.metaKey && event.key.toLowerCase() === "j") {
        event.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled, onOpenChange, open]);

  const active = useMemo(
    () => terminals.find((terminal) => terminal.active) ?? terminals[0] ?? null,
    [terminals],
  );

  const act = useCallback(async (body: Record<string, unknown>) => {
    if (!cwd) return;
    setError(null);
    await terminalRequest(cwd, body);
    await refresh();
  }, [cwd, refresh]);

  const create = useCallback(async () => {
    if (!cwd) return;
    try {
      await act({ action: "create" });
      onOpenChange(true);
      setMaximized(false);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  }, [act, cwd, onOpenChange]);

  const close = useCallback(async (terminal: TerminalInfo) => {
    if (!cwd) return;
    try {
      await act({ action: "close", id: terminal.id });
    } catch (failure) {
      const typed = failure as Error & { busy?: boolean };
      if (!typed.busy || !window.confirm(`“${terminal.name}”仍有程序在运行。确定终止并关闭吗？`)) {
        if (!typed.busy) setError(typed.message);
        return;
      }
      try { await act({ action: "close", id: terminal.id, force: true }); }
      catch (forcedFailure) { setError(forcedFailure instanceof Error ? forcedFailure.message : String(forcedFailure)); }
    }
  }, [act, cwd]);

  const rename = useCallback(() => {
    if (!active) return;
    setRenameValue(active.name);
    setRenameOpen(true); // Electron 不支持 window.prompt，用内联输入
  }, [active]);

  const commitRename = useCallback(async () => {
    const name = renameValue.trim();
    setRenameOpen(false);
    if (!active || !name || name === active.name) return;
    try { await act({ action: "rename", id: active.id, name }); }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
  }, [act, active, renameValue]);

  const toggleTrust = useCallback(async () => {
    if (!active) return;
    if (!active.trusted && !window.confirm("信任后，Agent 可自动向该终端及其中运行的交互式 CLI 输入内容，风险识别不再可靠。是否继续？")) return;
    try { await act({ action: "trust", id: active.id, trusted: !active.trusted }); }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
  }, [act, active]);

  const exportOutput = useCallback(() => {
    if (!active) return;
    const text = viewRef.current?.exportText() ?? "";
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${active.name.replace(/[^\w.-]+/g, "-") || "terminal"}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  }, [active]);

  const openSearch = useCallback(() => {
    setSearchOpen(true);
    queueMicrotask(() => searchInputRef.current?.focus());
  }, []);

  const startResize = useCallback((event: React.PointerEvent) => {
    if (!open || maximized) return;
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = height;
    const move = (moveEvent: PointerEvent) => {
      setHeight(Math.max(150, Math.min(window.innerHeight * 0.72, startHeight + startY - moveEvent.clientY)));
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  }, [height, maximized, open]);

  if (!cwd || !enabled || !open) return null;
  const panelHeight = maximized ? "calc(100dvh - 36px)" : height;
  const buttonStyle: React.CSSProperties = {
    minWidth: 26,
    height: 24,
    padding: "0 6px",
    border: "none",
    borderRadius: 4,
    background: "transparent",
    color: "var(--text-muted)",
    cursor: "pointer",
    fontSize: 11,
  };

  return (
    <section style={{ position: "relative", flex: `0 0 ${typeof panelHeight === "number" ? `${panelHeight}px` : panelHeight}`, minHeight: 32, display: "flex", flexDirection: "column", overflow: "hidden", borderTop: "1px solid var(--border)", background: "var(--bg)" }}>
      {!maximized && (
        <div onPointerDown={startResize} title="拖动调整终端高度" style={{ position: "absolute", top: -3, left: 0, right: 0, height: 6, zIndex: 4, cursor: "ns-resize" }} />
      )}
      <header style={{ height: 32, flexShrink: 0, display: "flex", alignItems: "center", gap: 4, padding: "0 6px", background: "var(--bg-panel)", borderBottom: "1px solid var(--border)" }}>
        <button type="button" onClick={() => onOpenChange(false)} style={{ ...buttonStyle, display: "flex", alignItems: "center", gap: 5, fontWeight: 650, color: "var(--text)" }} title="收起 Terminal（⌘J）" aria-label="收起终端">
          <span style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform 0.12s" }}>›</span>
          Terminal
        </button>
        <div style={{ flex: 1, display: "flex", alignItems: "center", overflowX: "auto", minWidth: 0 }}>
          {terminals.map((terminal) => (
            <div
              key={terminal.id}
              style={{
                height: 28,
                maxWidth: 190,
                display: "flex",
                alignItems: "center",
                borderBottom: terminal.active ? "2px solid var(--accent)" : "2px solid transparent",
                background: terminal.active ? "var(--bg)" : "transparent",
              }}
            >
              <button
                type="button"
                onClick={() => { onOpenChange(true); void act({ action: "activate", id: terminal.id }).catch((failure) => setError(String(failure))); }}
                title={`${terminal.cwd}\n${terminal.trusted ? "信任 Agent" : "保护模式"}`}
                aria-label={`切换到 ${terminal.name}`}
                style={{
                  minWidth: 0,
                  height: 26,
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  padding: "0 4px 0 8px",
                  border: "none",
                  background: "transparent",
                  color: terminal.active ? "var(--text)" : "var(--text-muted)",
                  cursor: "pointer",
                  fontSize: 11,
                  whiteSpace: "nowrap",
                }}
              >
                <span style={{ width: 6, height: 6, borderRadius: "50%", flexShrink: 0, background: terminal.running ? "#4ade80" : "var(--text-dim)" }} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{terminal.name}</span>
                {terminal.trusted && <span title="信任 Agent" style={{ color: "var(--accent)" }}>◆</span>}
              </button>
              <button
                type="button"
                aria-label={`关闭 ${terminal.name}`}
                title={`关闭 ${terminal.name}`}
                onClick={() => void close(terminal)}
                style={{ width: 22, height: 24, padding: 0, border: "none", background: "transparent", color: "var(--text-dim)", cursor: "pointer", fontSize: 14 }}
              >×</button>
            </div>
          ))}
        </div>
        <button type="button" onClick={() => void create()} style={buttonStyle} title="新建终端 / New terminal" aria-label="新建终端">＋</button>
        {active && open && <>
          <button type="button" onClick={rename} style={buttonStyle} title="重命名 / Rename" aria-label="重命名终端">Aa</button>
          <button type="button" onClick={openSearch} style={buttonStyle} title="搜索 / Search（⌘F）" aria-label="搜索终端输出">⌕</button>
          <button type="button" onClick={exportOutput} style={buttonStyle} title="导出文本 / Export" aria-label="导出终端输出">⇩</button>
          <button type="button" onClick={() => void toggleTrust()} style={{ ...buttonStyle, color: active.trusted ? "var(--accent)" : "var(--text-muted)" }} title={active.trusted ? "取消信任 Agent" : "信任 Agent"} aria-label={active.trusted ? "取消信任 Agent" : "信任 Agent"}>◆</button>
          <button type="button" onClick={() => { onOpenChange(true); setMaximized((value) => !value); }} style={buttonStyle} title={maximized ? "还原" : "最大化"} aria-label={maximized ? "还原终端面板" : "最大化终端面板"}>{maximized ? "↘" : "↗"}</button>
        </>}
      </header>

      {open && renameOpen && active && (
        <div style={{ position: "absolute", top: 34, right: 8, zIndex: 6, display: "flex", alignItems: "center", gap: 5, padding: "5px 6px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg-panel)", boxShadow: "0 8px 20px rgba(0,0,0,0.18)" }}>
          <input
            autoFocus
            value={renameValue}
            onChange={(event) => setRenameValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void commitRename();
              if (event.key === "Escape") setRenameOpen(false);
            }}
            onBlur={() => void commitRename()}
            placeholder="终端名称 / Terminal name"
            style={{ width: 180, height: 24, padding: "0 7px", border: "1px solid var(--accent)", borderRadius: 4, background: "var(--bg)", color: "var(--text)", fontSize: 11, outline: "none" }}
          />
        </div>
      )}

      {open && searchOpen && (
        <div style={{ height: 32, display: "flex", alignItems: "center", gap: 5, padding: "4px 8px", borderBottom: "1px solid var(--border)", background: "var(--bg-panel)" }}>
          <input
            ref={searchInputRef}
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setSearchOpen(false);
              if (event.key === "Enter") {
                if (event.shiftKey) viewRef.current?.findPrevious(searchQuery);
                else viewRef.current?.findNext(searchQuery);
              }
            }}
            placeholder="搜索终端输出 / Search"
            style={{ flex: 1, minWidth: 0, height: 24, padding: "0 7px", border: "1px solid var(--border)", borderRadius: 4, background: "var(--bg)", color: "var(--text)", fontFamily: "var(--font-mono)", fontSize: 11, outline: "none" }}
          />
          <button type="button" onClick={() => viewRef.current?.findPrevious(searchQuery)} style={buttonStyle} aria-label="上一个匹配">↑</button>
          <button type="button" onClick={() => viewRef.current?.findNext(searchQuery)} style={buttonStyle} aria-label="下一个匹配">↓</button>
          <button type="button" onClick={() => setSearchOpen(false)} style={buttonStyle} aria-label="关闭搜索">×</button>
        </div>
      )}

      {open && (
        <div style={{ flex: 1, minHeight: 0, overflow: "hidden", position: "relative" }}>
          {active ? (
            <TerminalView ref={viewRef} terminal={active} cwd={cwd} isDark={isDark} onRefresh={refresh} onError={setError} onRequestSearch={openSearch} />
          ) : (
            <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, color: "var(--text-muted)", fontSize: 12 }}>
              <span>当前项目还没有终端</span>
              <button type="button" onClick={() => void create()} style={{ ...buttonStyle, border: "1px solid var(--border)", background: "var(--bg-panel)", color: "var(--text)" }}>新建终端</button>
            </div>
          )}
          {error && (
            <button type="button" onClick={() => setError(null)} title="关闭提示" style={{ position: "absolute", right: 10, bottom: 8, maxWidth: "70%", padding: "5px 8px", border: "1px solid color-mix(in srgb, #f87171 45%, var(--border))", borderRadius: 5, background: "var(--bg-panel)", color: "#f87171", fontSize: 11, cursor: "pointer", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{error}</button>
          )}
        </div>
      )}
    </section>
  );
}
