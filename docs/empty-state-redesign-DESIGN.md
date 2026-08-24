# 空态首屏 + 输入卡片改版 DESIGN v0.1

基准：用户提供的竞品截图（AI 助手首页：居中圆形 Logo + 大号问候语 + 大圆角输入卡片，控件内嵌卡片底行）。
范围：pi-web 新会话空态（isEmptyNew）首屏排布 + ChatInput 输入卡片结构。**不改主题配色**（沿用深海极光暗色）。

## 借鉴项（按截图提取的排布语言）
1. 空态头部：居中圆形头像（白底圆形 + 柔和投影）+ 居中大号问候语，替代当前「左上头像+标题 / 右侧版本号」的横向排布
2. 输入区卡片化：textarea 在上，控制栏收进卡片内底部一行（当前在卡片外独立一行）
3. 卡片内控制排布：左侧「+ 附件 / 模型选择」，右侧「thinking / 工具 / 压缩 / Terminal / 声音 / 发送」
4. 发送按钮：长条 → 圆形 ↑ 箭头（accent 填充，对应截图最右圆形发送钮）
5. 卡片视觉：圆角 14→20，聚焦时 accent 描边；textarea 最小高 24→60（卡片整体 ≈76→112px，用户确认增高一半）

## Out of Scope（不照搬项）
- 浅色白底主题 → 保持暗色（历史决策：暖白极简大改版已被否决）
- mic 语音输入 → 无此功能
- 「从应用中获取更好的答案」集成栏 → 不适用
- 控件不收进二级菜单：我们控件比截图多，全部保留在一行内（移动端沿用现有「更多控制」折叠）

## 控件映射（零功能删减）
| 控件 | 现状 | 新位置 |
|---|---|---|
| 图片附件 | 卡片外底栏左 | 卡片内底行左，图标改 + |
| 模型选择 | 卡片外底栏左 | 卡片内底行左（图标+模型名，不变） |
| Terminal / thinking / 工具预设 / 压缩 / 声音 | 卡片外底栏右 | 卡片内底行右（顺序不变） |
| 发送 | 卡片内 textarea 同行，长条 | 卡片内底行最右，圆形 ↑ |
| steer / follow-up（streaming 态） | 卡片内 textarea 同行 | 卡片内底行最右 |
| 版本号 web/pi | 空态头部右侧 | 已移除（用户确认不要；NewSessionUpdateLink 一并删除） |
| 「PiPi Agent」标题文字 | 空态头部左侧 | 移除（头像+问候语替代；侧边栏仍有品牌） |
| 问候语 | 无 | 新增 i18n key `chat.emptyGreeting`（zh：今日事，我来帮。） |

## 结构改动（最小 diff）
- `components/ChatWindow.tsx`：仅 isEmptyNew 分支的头部块，横向 row → 居中 column（头像圆 + 问候 + 版本行）
- `components/ChatInput.tsx`：主输入容器 flex → flex-col；原「Bottom bar」整块移入卡片作为第二行；发送/steer 按钮移到底行最右；附件图标改 +；加 focus 态边框
- `lib/i18n/messages/{zh-CN,en}.ts`：新增问候语 key

## 待确认
- 问候语文案「今日事，我来帮。」（暂定，照搬截图措辞）
- 头像圆形白底在暗色主题下的观感（截图基准为浅色）

## v0.2 追加（用户已确认）
1. **「+」菜单**：添加图片 / @ 引用文件（插入 @ 触发文件补全）/ 技能子页（列出已安装技能，dormant 不展示，点击插入 `/skill:<名>`）
2. **滑杆菜单**：MCP 服务器子页（读写 `~/.pi/agent/mcp.json` + 项目 `.pi/mcp.json` 的 `disabled` 字段，新 API `/api/mcp-servers`，提示「切换后新会话生效」）；模式子页（full/off/read-only/default，**应用默认预设 default→full**；存量已存储偏好的用户不受影响）
3. **Terminal 完全移除**：面板/按钮/⌘J/`/terminal` 命令/agent terminal 工具注册/`/api/terminals`/terminal-manager 等 4 个 lib 文件及相关测试全删；`custom-ui-terminal`（扩展对话框渲染）与 `terminal-input`（扩展键盘输入）为扩展基建，保留
