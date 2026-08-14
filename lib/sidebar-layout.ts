// 侧栏「分组 + 手动排序」布局模型：按项目（projectRoot）持久化。
// order 元素："s:<根会话id>" | "g:<分组id>"；分组内 order 为根会话 id 列表。

export interface SidebarGroup {
  name: string;
  collapsed: boolean;
  order: string[];
}

export interface SidebarLayout {
  order: string[];
  groups: Record<string, SidebarGroup>;
}

export type TopEntry = { type: "session"; id: string } | { type: "group"; id: string };

export const EMPTY_LAYOUT: SidebarLayout = { order: [], groups: {} };

export function groupedSessionIds(layout: SidebarLayout): Set<string> {
  const set = new Set<string>();
  for (const g of Object.values(layout.groups)) for (const id of g.order) set.add(id);
  return set;
}

// 顶层展示顺序：未登记的新会话（按传入的最近活跃顺序）置顶 → 手动顺序 → 未登记分组兜底
export function computeTopEntries(rootIds: string[], layout: SidebarLayout): TopEntry[] {
  const grouped = groupedSessionIds(layout);
  const rootSet = new Set(rootIds);
  const inOrder = new Set(layout.order.filter((k) => k.startsWith("s:")).map((k) => k.slice(2)));
  const entries: TopEntry[] = [];
  const seen = new Set<string>();

  for (const id of rootIds) {
    if (grouped.has(id) || inOrder.has(id)) continue;
    seen.add(id);
    entries.push({ type: "session", id });
  }
  for (const key of layout.order) {
    if (key.startsWith("s:")) {
      const id = key.slice(2);
      if (!rootSet.has(id) || grouped.has(id) || seen.has(id)) continue;
      seen.add(id);
      entries.push({ type: "session", id });
    } else if (key.startsWith("g:")) {
      const gid = key.slice(2);
      if (layout.groups[gid]) entries.push({ type: "group", id: gid });
    }
  }
  for (const gid of Object.keys(layout.groups)) {
    if (!layout.order.includes(`g:${gid}`)) entries.push({ type: "group", id: gid });
  }
  return entries;
}

export function groupMembers(group: SidebarGroup, rootIds: string[]): string[] {
  const rootSet = new Set(rootIds);
  return group.order.filter((id) => rootSet.has(id));
}

function removeFromEverywhere(layout: SidebarLayout, sessionId: string): void {
  layout.order = layout.order.filter((k) => k !== `s:${sessionId}`);
  for (const g of Object.values(layout.groups)) {
    g.order = g.order.filter((id) => id !== sessionId);
  }
}

// 顶层排序/移动：把 key 插到 targetKey 前或后；不在 order 里的 key 先登记
export function moveTopEntry(layout: SidebarLayout, key: string, targetKey: string | null, before: boolean): SidebarLayout {
  if (key.startsWith("s:")) removeFromEverywhere(layout, key.slice(2));
  layout.order = layout.order.filter((k) => k !== key);
  if (!targetKey) {
    layout.order.push(key);
    return layout;
  }
  let idx = layout.order.indexOf(targetKey);
  if (idx === -1) {
    layout.order.push(key);
    return layout;
  }
  if (!before) idx += 1;
  layout.order.splice(idx, 0, key);
  return layout;
}

export function moveSessionToGroup(layout: SidebarLayout, sessionId: string, gid: string, index?: number): SidebarLayout {
  const g = layout.groups[gid];
  if (!g) return layout;
  removeFromEverywhere(layout, sessionId);
  const at = index === undefined ? g.order.length : Math.max(0, Math.min(index, g.order.length));
  g.order.splice(at, 0, sessionId);
  return layout;
}

// 组内排序
export function moveWithinGroup(layout: SidebarLayout, sessionId: string, gid: string, targetId: string | null, before: boolean): SidebarLayout {
  const g = layout.groups[gid];
  if (!g) return layout;
  g.order = g.order.filter((id) => id !== sessionId);
  if (!targetId || !g.order.includes(targetId)) {
    g.order.push(sessionId);
    return layout;
  }
  let idx = g.order.indexOf(targetId);
  if (!before) idx += 1;
  g.order.splice(idx, 0, sessionId);
  return layout;
}

export function createGroup(layout: SidebarLayout, gid: string, name: string): SidebarLayout {
  layout.groups[gid] = { name, collapsed: false, order: [] };
  layout.order.push(`g:${gid}`);
  return layout;
}

export function deleteGroup(layout: SidebarLayout, gid: string): SidebarLayout {
  // 成员回到未分组（不登记进 order → 以“新会话”身份出现在顶部未分组区）
  delete layout.groups[gid];
  layout.order = layout.order.filter((k) => k !== `g:${gid}`);
  return layout;
}

// 清理：移除已不存在的会话引用，保持布局最小
export function pruneLayout(layout: SidebarLayout, existingRootIds: string[]): SidebarLayout {
  const rootSet = new Set(existingRootIds);
  layout.order = layout.order.filter((k) => {
    if (k.startsWith("s:")) return rootSet.has(k.slice(2));
    if (k.startsWith("g:")) return Boolean(layout.groups[k.slice(2)]);
    return false;
  });
  for (const g of Object.values(layout.groups)) {
    g.order = g.order.filter((id) => rootSet.has(id));
  }
  return layout;
}
