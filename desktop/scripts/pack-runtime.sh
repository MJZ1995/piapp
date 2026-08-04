#!/bin/bash
# 打包自包含运行时：Node 运行时 + pi-web 生产产物 → desktop/update/runtime.tar.gz
# 供局域网更新分享与 DMG 自包含安装使用。
set -euo pipefail

DESKTOP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO="$(cd "$DESKTOP_DIR/.." && pwd)"
UPDATE_DIR="$DESKTOP_DIR/update"
STAGE="$UPDATE_DIR/runtime"
NODE_BIN="${PI_WEB_NODE:-$HOME/.local/bin/node}"
VERSION="$(date +%Y%m%d%H%M)"

echo "==> 清理旧产物"
rm -rf "$STAGE" "$UPDATE_DIR/runtime.tar.gz" "$UPDATE_DIR/manifest.json"
mkdir -p "$STAGE/pi-web"

echo "==> 复制 pi-web 源码（不含依赖与构建产物）"
rsync -a \
  --exclude='.git' --exclude='node_modules' --exclude='.next' --exclude='.next.new' --exclude='.next.previous' \
  --exclude='desktop/dist' --exclude='desktop/update' --exclude='desktop/node_modules' \
  "$REPO/" "$STAGE/pi-web/"

echo "==> 复制生产构建 .next（不含 cache）"
rsync -a --exclude='cache/' "$REPO/.next/" "$STAGE/pi-web/.next/"

echo "==> 复制 node_modules 并裁剪 devDependencies"
rsync -aL "$REPO/node_modules/" "$STAGE/pi-web/node_modules/"
cd "$STAGE/pi-web"
npm prune --omit=dev --no-audit --no-fund --loglevel=error || true
# node-pty 原生模块执行权限（macOS spawn-helper 可能丢失 x 位）
chmod +x node_modules/node-pty/build/Release/spawn-helper 2>/dev/null || true
[ -x node_modules/node-pty/build/Release/pty.node ] || chmod +x node_modules/node-pty/build/Release/pty.node 2>/dev/null || true

echo "==> 复制 Node 运行时"
cp "$NODE_BIN" "$STAGE/node"
chmod +x "$STAGE/node"

echo "==> 生成 manifest 与压缩包"
SIZE=$(du -sm "$STAGE" | cut -f1)
echo "    运行时体积: ${SIZE}M"
# App 内置运行时版本标记（首启释放与更新版本对比）——必须先于 tar 写入
cat > "$STAGE/manifest.json" <<EOF
{ "version": "$VERSION", "builtAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)" }
EOF
cd "$UPDATE_DIR"
tar -czf runtime.tar.gz runtime
SHA=$(shasum -a 256 runtime.tar.gz | cut -d' ' -f1)
TGZ_SIZE=$(stat -f%z runtime.tar.gz)
cat > manifest.json <<EOF
{
  "version": "$VERSION",
  "builtAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "sha256": "$SHA",
  "size": $TGZ_SIZE,
  "file": "runtime.tar.gz"
}
EOF
echo "==> 完成: version=$VERSION sha256=${SHA:0:12}… tgz=$((TGZ_SIZE/1024/1024))M"
