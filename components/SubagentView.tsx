"use client";

import { useEffect, useRef } from "react";
import type { AssistantMessage } from "@/lib/types";
import { useI18n } from "@/hooks/useI18n";
import type { SubagentTab } from "@/lib/subagent-tabs";
import { MarkdownBody } from "./MarkdownBody";

interface Props {
  tab: SubagentTab;
  label: string;
  cwd?: string;
  onOpenFile?: (filePath: string) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// 子 agent 消息保持 pi 原始格式：toolCall 块可能是 toolName/input，
// 也可能是 name/arguments。
function toolCallLine(block: Record<string, unknown>): { name: string; preview: string } {
  const name = (typeof block.toolName === "string" && block.toolName)
    || (typeof block.name === "string" && block.name)
    || "tool";
  const input = isRecord(block.input) ? block.input : (isRecord(block.arguments) ? block.arguments : {});
  const keys = Object.keys(input);
  let preview = "";
  for (const key of ["command", "path", "file_path", "pattern", "query"]) {
    if (key in input) {
      preview = String(input[key]);
      break;
    }
  }
  if (!preview && keys.length > 0) preview = String(input[keys[0]]);
  if (preview.length > 120) preview = `${preview.slice(0, 120)}…`;
  return { name, preview };
}

function textOfContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => isRecord(block) && block.type === "text" && typeof block.text === "string")
    .map((block) => (block as { text: string }).text)
    .join("\n");
}

function UserTaskBlock({ text }: { text: string }) {
  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 10,
        background: "var(--bg-panel)",
        color: "var(--text-muted)",
        fontSize: 13,
        padding: "8px 12px",
        marginBottom: 12,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      }}
    >
      {text}
    </div>
  );
}

export function SubagentView({ tab, label, cwd, onOpenFile }: Props) {
  const { t } = useI18n();
  const scrollRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);
  const result = tab.result;
  const messages = result?.messages ?? [];
  const running = tab.status === "running";

  // 打开标签时先定位到底部
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    nearBottomRef.current = true;
  }, [tab.id]);

  // 运行中跟随最新输出；用户上翻时不动
  useEffect(() => {
    const el = scrollRef.current;
    if (el && running && nearBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [messages.length, running]);

  const usageParts: string[] = [];
  if (result) {
    usageParts.push(t("subagent.usage.turns", { count: result.usage.turns }));
    usageParts.push(t("subagent.usage.input", { count: result.usage.input.toLocaleString() }));
    usageParts.push(t("subagent.usage.output", { count: result.usage.output.toLocaleString() }));
    if (result.usage.cost) usageParts.push(`$${result.usage.cost.toFixed(4)}`);
    if (result.model) usageParts.push(result.model);
  }

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 20,
        background: "var(--bg)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        style={{ flex: 1, overflowY: "auto", overflowX: "hidden", padding: "16px 16px 8px" }}
      >
        <div style={{ maxWidth: 820, margin: "0 auto" }}>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12 }}>
            {label}
            {" · "}
            {t(`subagent.status.${tab.status}`)}
          </div>
          {messages.length === 0 && (
            <div style={{ fontSize: 13, color: "var(--text-muted)" }}>{t("subagent.empty")}</div>
          )}
          {messages.map((msg, index) => {
            if (msg.role === "user") {
              const text = textOfContent(msg.content).trim();
              return text ? <UserTaskBlock key={index} text={text} /> : null;
            }
            if (msg.role === "assistant") {
              const content = (msg as AssistantMessage).content;
              if (!Array.isArray(content)) return null;
              return content.map((block, blockIndex) => {
                if (!isRecord(block)) return null;
                if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
                  return (
                    <div key={`${index}-${blockIndex}`} style={{ marginBottom: 12 }}>
                      <MarkdownBody cwd={cwd} onOpenFile={onOpenFile}>{block.text}</MarkdownBody>
                    </div>
                  );
                }
                if (block.type === "thinking" && typeof block.thinking === "string" && block.thinking.trim()) {
                  return (
                    <div
                      key={`${index}-${blockIndex}`}
                      style={{
                        fontSize: 12,
                        color: "var(--text-muted)",
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                        borderLeft: "2px solid var(--border)",
                        paddingLeft: 10,
                        marginBottom: 12,
                        opacity: 0.85,
                      }}
                    >
                      {block.thinking}
                    </div>
                  );
                }
                if (block.type === "toolCall") {
                  const { name, preview } = toolCallLine(block);
                  return (
                    <div
                      key={`${index}-${blockIndex}`}
                      style={{
                        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                        fontSize: 12,
                        color: "var(--text-muted)",
                        padding: "2px 0",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      <span aria-hidden="true">→ </span>
                      <span style={{ color: "var(--text)" }}>{name}</span>
                      {preview ? ` ${preview}` : ""}
                    </div>
                  );
                }
                return null;
              });
            }
            if (msg.role === "toolResult" && msg.isError) {
              const text = textOfContent(msg.content).trim();
              if (!text) return null;
              return (
                <div key={index} className="text-red-400" style={{ fontSize: 12, marginBottom: 8, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                  {text.length > 300 ? `${text.slice(0, 300)}…` : text}
                </div>
              );
            }
            return null;
          })}
        </div>
      </div>
      {result && (
        <div
          style={{
            flexShrink: 0,
            borderTop: "1px solid var(--border)",
            padding: "8px 16px",
          }}
        >
          <div style={{ maxWidth: 820, margin: "0 auto", fontSize: 12, color: "var(--text-muted)" }}>
            {usageParts.join(" · ")}
            {result.errorMessage && (
              <span className="text-red-400">
                {" · "}
                {result.errorMessage}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
