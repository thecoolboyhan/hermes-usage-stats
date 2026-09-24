#!/usr/bin/env bash
#
# install.sh — Hermes Usage Stats 跨平台一键安装
# 支持: macOS / Linux / Windows (Git Bash / WSL)
#
set -euo pipefail

HERMES_BASE="${HERMES_HOME:-$(python3 -c "import os; print(os.path.expanduser('~/.hermes'))")}"
PLUGIN_DST="${HERMES_BASE}/desktop-plugins/usage-stats"
DAEMON_DST="${HERMES_BASE}/plugins/usage-stats"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

detect_platform() {
    case "$(uname -s)" in
        Darwin)  echo "macos" ;;
        Linux)   echo "linux" ;;
        MINGW*|MSYS*|CYGWIN*) echo "windows" ;;
        *)       echo "unknown" ;;
    esac
}
PLATFORM="$(detect_platform)"

echo "=== Hermes Usage Stats 安装 ==="
echo "  平台: ${PLATFORM}"
echo "  Hermes: ${HERMES_BASE}"
echo ""

# ── 备份旧文件 ──
for dir in "$PLUGIN_DST" "$DAEMON_DST"; do
    if [[ -d "$dir" ]]; then
        BACKUP="${dir}.bak-$(date +%Y%m%d%H%M%S)"
        echo "[backup] $dir → $BACKUP"
        mv "$dir" "$BACKUP"
    fi
done

# ── 安装 plugin ──
echo ""
echo "[install] plugin → $PLUGIN_DST"
mkdir -p "$PLUGIN_DST"
cp "${SCRIPT_DIR}/plugin/plugin.js"   "$PLUGIN_DST/"
cp "${SCRIPT_DIR}/plugin/plugin.json" "$PLUGIN_DST/"

# ── 安装 daemon ──
echo "[install] daemon → $DAEMON_DST"
mkdir -p "$DAEMON_DST/launchd"
cp "${SCRIPT_DIR}/daemon/daemon.py"  "$DAEMON_DST/"
cp "${SCRIPT_DIR}/daemon/manage.sh" "$DAEMON_DST/"
if [[ -d "${SCRIPT_DIR}/daemon/launchd" ]]; then
    cp "${SCRIPT_DIR}/daemon/launchd/"*.plist "$DAEMON_DST/launchd/" 2>/dev/null || true
fi

# ── 启动 daemon（平台相关）──
echo ""
echo "[daemon] 启动 (平台: $PLATFORM)..."
cd "$DAEMON_DST"
bash manage.sh install

echo ""
echo "=== 安装完成 ==="
echo "  重启 Hermes Desktop，然后按 ⌘K（或 Ctrl+K）→ Reload"
echo "  用量按钮: 状态栏 📊"
