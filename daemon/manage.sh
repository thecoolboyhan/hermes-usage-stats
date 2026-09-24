#!/usr/bin/env bash
# 用量 daemon 安装/卸载/状态
# Usage:
#   bash manage.sh install   # 安装 launchd 任务
#   bash manage.sh uninstall # 卸载
#   bash manage.sh status    # 查看状态
#   bash manage.sh restart   # 重启
#   bash manage.sh logs      # 看日志
set -u

PLIST_NAME="com.admin.hermes.usage-stats-daemon"
PLIST_SRC="$HOME/.hermes/plugins/usage-stats/launchd/${PLIST_NAME}.plist"
PLIST_DST="$HOME/Library/LaunchAgents/${PLIST_NAME}.plist"
DAEMON_PY="$HOME/.hermes/plugins/usage-stats/daemon.py"
LOG_DIR="$HOME/.hermes/plugins/usage-stats"

case "${1:-status}" in
  install)
    mkdir -p "$HOME/Library/LaunchAgents"
    # 用绝对路径（保证 launchd 能找到）
    sed "s|/Users/admin/|$HOME/|g" "$PLIST_SRC" > "$PLIST_DST"
    launchctl unload "$PLIST_DST" 2>/dev/null
    launchctl load "$PLIST_DST"
    echo "installed: $PLIST_DST"
    sleep 1
    bash "$0" status
    ;;
  uninstall)
    launchctl unload "$PLIST_DST" 2>/dev/null && echo "unloaded"
    rm -f "$PLIST_DST" && echo "removed plist"
    # 杀掉可能残留的进程
    if [ -f "$LOG_DIR/daemon.pid" ]; then
      kill "$(cat "$LOG_DIR/daemon.pid")" 2>/dev/null && echo "killed residual"
    fi
    rm -f "$LOG_DIR/daemon.json" "$LOG_DIR/daemon.pid"
    ;;
  status)
    echo "=== launchd 任务 ==="
    launchctl list | grep -i "$PLIST_NAME" || echo "(未加载)"
    echo
    echo "=== 端口文件 ==="
    if [ -f "$LOG_DIR/daemon.json" ]; then
      cat "$LOG_DIR/daemon.json"
    else
      echo "(daemon 未写端口文件，未运行?)"
    fi
    echo
    echo "=== /health ==="
    if [ -f "$LOG_DIR/daemon.json" ]; then
      PORT=$(python3 -c "import json; print(json.load(open('$LOG_DIR/daemon.json'))['port'])" 2>/dev/null)
      if [ -n "$PORT" ]; then
        curl -sS --max-time 2 "http://127.0.0.1:$PORT/health" && echo
      fi
    fi
    ;;
  restart)
    if [ -f "$LOG_DIR/daemon.pid" ]; then
      kill "$(cat "$LOG_DIR/daemon.pid")" 2>/dev/null
    fi
    launchctl kickstart -k "gui/$(id -u)/$PLIST_NAME" 2>/dev/null || launchctl unload "$PLIST_DST" 2>/dev/null
    launchctl load "$PLIST_DST" 2>/dev/null
    sleep 1
    bash "$0" status
    ;;
  logs)
    echo "=== launchd stdout ==="
    tail -30 "$LOG_DIR/launchd/stdout.log" 2>/dev/null || echo "(no stdout)"
    echo "=== launchd stderr ==="
    tail -30 "$LOG_DIR/launchd/stderr.log" 2>/dev/null || echo "(no stderr)"
    echo "=== daemon 自打 ==="
    tail -30 "$LOG_DIR/daemon.log" 2>/dev/null || echo "(no daemon log)"
    ;;
  *)
    echo "Usage: $0 {install|uninstall|status|restart|logs}"
    exit 1
    ;;
esac