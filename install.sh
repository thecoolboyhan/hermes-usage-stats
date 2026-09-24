#!/usr/bin/env bash
#
# install.sh — Hermes Usage Stats 一键安装
# 适用于 macOS + Hermes 桌面端
#
set -euo pipefail

HERMES_BASE="${HOME}/.hermes"
PLUGIN_DST="${HERMES_BASE}/desktop-plugins/usage-stats"
DAEMON_DST="${HERMES_BASE}/plugins/usage-stats"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== Hermes Usage Stats 安装 ==="
echo "  Hermes: ${HERMES_BASE}"
echo ""

# ── 1. 备份旧文件 ──
for dir in "$PLUGIN_DST" "$DAEMON_DST"; do
    if [[ -d "$dir" ]]; then
        BACKUP="${dir}.bak-$(date +%Y%m%d%H%M%S)"
        echo "[backup] $dir → $BACKUP"
        mv "$dir" "$BACKUP"
    fi
done

# ── 2. 安装 plugin ──
echo ""
echo "[install] plugin → $PLUGIN_DST"
mkdir -p "$PLUGIN_DST"
cp "${SCRIPT_DIR}/plugin/plugin.js"    "$PLUGIN_DST/"
cp "${SCRIPT_DIR}/plugin/plugin.json"  "$PLUGIN_DST/"

# ── 3. 安装 daemon ──
echo "[install] daemon → $DAEMON_DST"
mkdir -p "$DAEMON_DST/launchd"
cp "${SCRIPT_DIR}/daemon/daemon.py"    "$DAEMON_DST/"
cp "${SCRIPT_DIR}/daemon/manage.sh"   "$DAEMON_DST/"
cp "${SCRIPT_DIR}/daemon/launchd/"*.plist "$DAEMON_DST/launchd/"

# ── 4. 启动 daemon ──
echo ""
echo "[launchd] 注册 daemon..."
cd "$DAEMON_DST"
bash manage.sh install

echo ""
echo "=== 安装完成 ==="
echo "  重启 Hermes 桌面端，然后按 ⌘K → Reload"
echo "  用量按钮: 状态栏 📊"
