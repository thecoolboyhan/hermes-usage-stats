#!/usr/bin/env bash
# Hermes Usage Stats Plugin — 一键卸载

set -e

DAEMON_DST="$HOME/.hermes/plugins/usage-stats"
PLUGIN_DST="$HOME/.hermes/desktop-plugins/usage-stats"

echo "==> 卸载 Hermes Usage Stats"

# 1) 停 daemon
if [ -d "$DAEMON_DST" ]; then
    bash "$DAEMON_DST/manage.sh" uninstall
    rm -rf "$DAEMON_DST"
    echo "  ✓ daemon 已删除"
fi

# 2) 删 plugin
if [ -d "$PLUGIN_DST" ]; then
    rm -rf "$PLUGIN_DST"
    echo "  ✓ plugin 已删除"
fi

echo
echo "==> 卸载完成。Hermes 桌面端 ⌘K → Reload 后按钮消失。"
