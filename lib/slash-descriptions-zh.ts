"use strict";

// 斜杠命令描述的中文映射（仅用于界面显示与搜索匹配，不影响命令执行）。
// 键为命令全名；未收录的命令回退显示原始描述。
// 新增技能/扩展后，如需中文描述在此补充一行即可。
export const SLASH_DESCRIPTION_ZH: Record<string, string> = {
  // ─── 技能（来源：~/.pi/agent/skills/*/SKILL.md 的 description） ───
  "skill:brave-search": "网页搜索与内容提取（Brave Search API）。查文档、查事实或任意网页内容，轻量无需浏览器。",
  "skill:browser-tools": "交互式浏览器自动化（Chrome DevTools Protocol）。需要操作网页、测试前端或可见浏览器交互时使用。",
  "skill:transcribe": "Apple Silicon Mac 本地语音转文字。直接支持 wav，其他音频格式经 ffmpeg 转换。",

  // ─── ponytail（npm:@dietrichgebert/ponytail） ───
  "skill:ponytail": "强制采用「能跑就行」的最简方案：代码最少、成本最低。资深工程师的克制人格。",
  "skill:ponytail-audit": "全仓库过度工程审计：输出该删除、该简化的排序清单。",
  "skill:ponytail-debt": "收集代码中所有 ponytail: 注释，生成技术债台账。",
  "skill:ponytail-gain": "展示 ponytail 的实测收益记分板（代码量 / 成本 / 速度）。",
  "skill:ponytail-help": "ponytail 全部模式、技能与命令的速查卡。",
  "skill:ponytail-review": "专注过度工程的代码评审：重复造轮子、多余依赖、投机性抽象。",

  // ─── pi-hermes-memory 扩展命令（npm:pi-hermes-memory） ───
  "memory-consolidate": "手动触发记忆整理合并，释放存储空间。",
  "memory-index-sessions": "将历史会话导入搜索数据库，建立全文索引（一次性）。",
  "memory-insights": "查看持久记忆中已存储的内容。",
  "memory-interview": "回答几个问题预填用户画像，让 agent 跨会话记住你。",
  "learn-memory-tool": "学习如何高效使用 pi-hermes-memory 记忆扩展。",
  "memory-preview-context": "预览注入到上下文的记忆策略或记忆块。",
  "memory-skills": "管理全局、当前项目与外部加载的过程技能。",
  "memory-switch-project": "切换项目级记忆的当前项目。",
};

export function translateSlashCommand<T extends { name: string; description?: string }>(cmd: T): T {
  const zh = SLASH_DESCRIPTION_ZH[cmd.name];
  return zh ? { ...cmd, description: zh } : cmd;
}
