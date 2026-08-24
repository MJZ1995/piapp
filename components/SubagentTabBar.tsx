"use client";

import { useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useIsMobile } from "@/hooks/useIsMobile";
import type { SubagentTab, SubagentTabStatus } from "@/lib/subagent-tabs";

const STATUS_ICON: Record<SubagentTabStatus, string> = {
  running: "⏳",
  done: "✓",
  error: "✗",
  aborted: "⊘",
};

const STATUS_ICON_CLASS: Record<SubagentTabStatus, string> = {
  running: "animate-[pulse_1.5s_infinite] text-amber-500",
  done: "text-green-500",
  error: "text-red-400",
  aborted: "text-text-muted",
};

interface Props {
  tabs: SubagentTab[];
  /** null = 主进程标签激活 */
  activeId: string | null;
  renamedLabels: Record<string, string>;
  onSelect: (id: string | null) => void;
  onClose: (id: string) => void;
  onRename: (id: string, label: string) => void;
}

interface TabItemProps {
  label: string;
  status: SubagentTabStatus | null;
  active: boolean;
  statusText: string | null;
  renameTitle: string | null;
  closeTitle: string | null;
  onSelect: () => void;
  onClose?: () => void;
  onRename?: (label: string) => void;
}

function TabItem({ label, status, active, statusText, renameTitle, closeTitle, onSelect, onClose, onRename }: TabItemProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const commit = () => {
    setEditing(false);
    onRename?.(draft);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !editing) onSelect();
      }}
      onDoubleClick={onRename ? () => {
        setDraft(label);
        setEditing(true);
      } : undefined}
      title={editing ? undefined : (statusText ?? renameTitle ?? undefined)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        maxWidth: 220,
        padding: "4px 10px",
        border: "1px solid var(--border)",
        borderRadius: 8,
        background: active ? "var(--bg-selected)" : "transparent",
        color: "var(--text)",
        fontSize: 12,
        lineHeight: "18px",
        cursor: "pointer",
        userSelect: "none",
        flexShrink: 0,
      }}
    >
      {status && (
        <span className={STATUS_ICON_CLASS[status]} style={{ fontSize: 11, flexShrink: 0 }} aria-hidden="true">
          {STATUS_ICON[status]}
        </span>
      )}
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") setEditing(false);
            e.stopPropagation();
          }}
          style={{
            width: 120,
            border: "none",
            outline: "none",
            background: "transparent",
            color: "inherit",
            font: "inherit",
          }}
        />
      ) : (
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {label}
        </span>
      )}
      {onClose && !editing && (
        <button
          type="button"
          aria-label={closeTitle ?? "Close"}
          title={closeTitle ?? undefined}
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          style={{
            border: "none",
            background: "transparent",
            color: "var(--text-muted)",
            cursor: "pointer",
            padding: 0,
            fontSize: 13,
            lineHeight: "14px",
            flexShrink: 0,
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}

export function SubagentTabBar({ tabs, activeId, renamedLabels, onSelect, onClose, onRename }: Props) {
  const { t } = useI18n();
  const isMobile = useIsMobile();

  return (
    <div
      style={{
        padding: "4px 16px 6px",
        paddingRight: isMobile ? 16 : 52, // 与 ChatInput 对齐（桌面端预留 ChatMinimap 宽度）
        flexShrink: 0,
      }}
    >
      <div
        style={{
          maxWidth: 820,
          margin: "0 auto",
          display: "flex",
          alignItems: "center",
          gap: 6,
          overflowX: "auto",
          scrollbarWidth: "none",
        }}
      >
        <TabItem
          label={t("subagent.mainTab")}
          status={null}
          active={activeId === null}
          statusText={null}
          renameTitle={null}
          closeTitle={null}
          onSelect={() => onSelect(null)}
        />
        {tabs.map((tab) => (
          <TabItem
            key={tab.id}
            label={renamedLabels[tab.id] ?? tab.label}
            status={tab.status}
            active={tab.id === activeId}
            statusText={t(`subagent.status.${tab.status}`)}
            renameTitle={t("subagent.renameTab")}
            closeTitle={t("subagent.closeTab")}
            onSelect={() => onSelect(tab.id)}
            onClose={() => onClose(tab.id)}
            onRename={(label) => onRename(tab.id, label)}
          />
        ))}
      </div>
    </div>
  );
}
