# 局域网分享与更新使用说明

## 角色

| 角色 | 机器 | 模式 |
|---|---|---|
| 分享者（你） | 开发机（config.json 有 repoPath） | 开发模式不变，托盘多出「分享局域网更新…」 |
| 同事 | 零依赖安装 DMG | 自包含模式，托盘有「检查局域网更新…」 |

## 同事首次安装

1. 发送 `desktop/dist/Yasuo Agent-<版本>-arm64.dmg` 给同事（AirDrop/IM 均可）。
2. 同事拖入 Applications，首次【右键 → 打开】一次（未做 Apple 公证）。
3. 打开后点左下角「Models」配置自己的模型账号。
4. 会话/配置/记忆都在同事本机 `~/.pi`，覆盖安装或更新均不丢失。

## 发布一次更新（你）

```bash
cd "desktop"
./scripts/pack-runtime.sh        # 打包运行时 → desktop/update/
```

托盘图标 →「分享局域网更新…」→ 屏幕显示版本号与 6 位配对码。
（想常驻分享：`PI_WEB_LAN_SHARE_AUTO=1` 启动即自动开启。）

## 同事更新（同一 WiFi）

托盘图标 →「检查局域网更新…」→ 自动发现你的机器 → 首次输入配对码 →
「立即更新」→ 下载校验（SHA-256）→「立即重启」。

只替换 `~/Library/Application Support/.../runtime/`，不碰 App 本体与任何个人数据。
你不在线/不同 WiFi 时会提示未发现更新源，不影响使用；也可用新 DMG 覆盖安装。

## 注意

- 首次使用 Bonjour 发现可能触发 macOS「本地网络」权限弹窗，允许即可。
- App 壳（Electron）极少更新；壳有变化时才需要发新 DMG。
