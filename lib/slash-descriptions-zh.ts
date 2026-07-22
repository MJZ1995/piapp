"use strict";

// 斜杠命令描述的中文映射（仅用于界面显示与搜索匹配，不影响命令执行）。
// 键为命令全名；未收录的命令回退显示原始描述。
// 新增技能/扩展后，如需中文描述在此补充一行即可。
export const SLASH_DESCRIPTION_ZH: Record<string, string> = {
  // 技能（来源：~/.pi/agent/skills/*/SKILL.md 的 description）
  "skill:brave-search": "网页搜索与内容提取（Brave Search API）。查文档、查事实或任意网页内容，轻量无需浏览器。",
  "skill:browser-tools": "交互式浏览器自动化（Chrome DevTools Protocol）。需要操作网页、测试前端或可见浏览器交互时使用。",
  "skill:transcribe": "Apple Silicon Mac 本地语音转文字。直接支持 wav，其他音频格式经 ffmpeg 转换。",
};

export function translateSlashCommand<T extends { name: string; description?: string }>(cmd: T): T {
  const zh = SLASH_DESCRIPTION_ZH[cmd.name];
  return zh ? { ...cmd, description: zh } : cmd;
}
