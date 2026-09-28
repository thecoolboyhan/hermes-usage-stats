#!/usr/bin/env bash
#
# manage.sh — 用量 daemon 跨平台运维脚本
#
# 支持: macOS (launchd) / Linux (systemd --user) / Windows (后台进程)
# 用法:
#   bash manage.sh install    # 安装并启动 daemon
#   bash manage.sh uninstall  # 停止并卸载
#   bash manage.sh status     # 查看状态
#   bash manage.sh restart    # 重启
#   bash manage.sh logs       # 看日志
#
set -u

# ── 平台检测 ──────────────────────────────────────────
detect_platform() {
    case "$(uname -s)" in
        Darwin)    echo "macos" ;;
        Linux)     echo "linux" ;;
        MINGW*|MSYS*|CYGWIN*) echo "windows" ;;
        *)         echo "unknown" ;;
    esac
}

PLATFORM="$(detect_platform)"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DAEMON_PY="${SCRIPT_DIR}/daemon.py"
DAEMON_PID="${SCRIPT_DIR}/daemon.pid"
DAEMON_JSON="${SCRIPT_DIR}/daemon.json"
DAEMON_LOG="${SCRIPT_DIR}/daemon.log"

# Python 解释器探测：macOS/Linux 为 python3；Windows(Git Bash) 只有 python / py
case "$PLATFORM" in
    windows)
        PYTHON_BIN="$(command -v python3 || command -v python || command -v py || true)"
        ;;
    *)
        PYTHON_BIN="$(command -v python3 || command -v python || true)"
        ;;
esac
if [ -z "$PYTHON_BIN" ]; then
    echo "ERROR: 未找到 Python 解释器（需要 python3/python/py 任一）" >&2
    exit 1
fi

PLIST_NAME="com.admin.hermes.usage-stats-daemon"
PLIST_SRC="${SCRIPT_DIR}/launchd/${PLIST_NAME}.plist"
PLIST_DST="${HOME}/Library/LaunchAgents/${PLIST_NAME}.plist"

SYSTEMD_UNIT="${HOME}/.config/systemd/user/hermes-usage-stats.service"
SYSTEMD_DIR="$(dirname "$SYSTEMD_UNIT")"

# ── 通用工具函数 ──────────────────────────────────────
get_port() {
    # 用 sed 解析而非 python -c：Git Bash 的 POSIX 路径（/c/...）嵌入
    # python 字符串参数时不会被 MSYS 自动转换成 Windows 路径
    [ -f "$DAEMON_JSON" ] && sed -n 's/.*"port": \([0-9]*\).*/\1/p' "$DAEMON_JSON" | head -1
}

is_running() {
    if [ -f "$DAEMON_PID" ]; then
        local pid
        pid=$(cat "$DAEMON_PID" 2>/dev/null)
        if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
            return 0
        fi
    fi
    return 1
}

wait_for_health() {
    local port="$1"
    local max_wait=5
    for i in $(seq 1 "$max_wait"); do
        if curl -sS --max-time 1 "http://127.0.0.1:${port}/health" > /dev/null 2>&1; then
            return 0
        fi
        sleep 1
    done
    return 1
}

# ── 启动 daemon（所有平台通用）──────────────────────────
start_daemon() {
    if is_running; then
        echo "(daemon 已运行，pid=$(cat $DAEMON_PID))"
        return 0
    fi

    rm -f "$DAEMON_JSON" "$DAEMON_PID"

    nohup python3 "$DAEMON_PY" >> "$DAEMON_LOG" 2>&1 &
    local new_pid=$!
    echo "$new_pid" > "$DAEMON_PID"

    local tries=0
    while [ ! -s "$DAEMON_JSON" ] && [ $tries -lt 10 ]; do
        sleep 0.5
        tries=$((tries + 1))
    done

    if [ -s "$DAEMON_JSON" ]; then
        local port
        port=$(get_port)
        if wait_for_health "$port"; then
            echo "daemon 启动成功 pid=$new_pid port=$port"
        else
            echo "WARNING: daemon 进程在但 /health 无响应"
        fi
    else
        echo "WARNING: daemon 进程启动但未分配端口（可能失败）"
    fi
}

stop_daemon() {
    if is_running; then
        local pid
        pid=$(cat "$DAEMON_PID")
        kill "$pid" 2>/dev/null
        rm -f "$DAEMON_PID"
        # Windows 上 kill 为 TerminateProcess，daemon 的 SIGTERM 清理不会执行，
        # 这里统一兜底清掉端口文件，避免插件试连死端口
        rm -f "$DAEMON_JSON"
        echo "daemon 已停止 (kill $pid)"
    else
        rm -f "$DAEMON_PID" "$DAEMON_JSON"
        echo "(daemon 未运行)"
    fi
}

# ── macOS (launchd) ──────────────────────────────────
do_install_macos() {
    mkdir -p "$(dirname "$PLIST_DST")"
    local hermes_home
    hermes_home=$(python3 -c "import os; print(os.path.expanduser('~/.hermes'))")
    sed "s|/Users/admin/|${hermes_home}/|g" "$PLIST_SRC" > "$PLIST_DST"
    echo "installed plist: $PLIST_DST"
    launchctl unload "$PLIST_DST" 2>/dev/null
    launchctl load "$PLIST_DST"
    sleep 1
    echo ""
    do_status
}

do_uninstall_macos() {
    launchctl unload "$PLIST_DST" 2>/dev/null && echo "launchd unloaded"
    rm -f "$PLIST_DST"
    stop_daemon
    echo "macOS 安装残留已清理"
}

# ── Linux (systemd --user) ────────────────────────────
do_install_linux() {
    mkdir -p "$SYSTEMD_DIR"
    cat > "$SYSTEMD_UNIT" << EOF
[Unit]
Description=Hermes Usage Stats Daemon

[Service]
Type=simple
ExecStart=/usr/bin/env python3 "${DAEMON_PY}"
Restart=always
RestartSec=3
StandardOutput=append:${DAEMON_LOG}
StandardError=append:${DAEMON_LOG}

[Install]
WantedBy=default.target
EOF
    echo "installed systemd unit: $SYSTEMD_UNIT"
    systemctl --user daemon-reload 2>/dev/null || echo "(systemd --user 不可用，跳过)"
    systemctl --user enable hermes-usage-stats 2>/dev/null || echo "(enable 失败)"
    systemctl --user start hermes-usage-stats 2>/dev/null
    sleep 1
    echo ""
    do_status
}

do_uninstall_linux() {
    systemctl --user stop hermes-usage-stats 2>/dev/null
    systemctl --user disable hermes-usage-stats 2>/dev/null
    rm -f "$SYSTEMD_UNIT"
    stop_daemon
    echo "Linux 安装残留已清理"
}

# ── Windows (后台进程 + 登录自启) ─────────────────────
WIN_TASK_NAME="HermesUsageStatsDaemon"

do_install_windows() {
    start_daemon
    # 开机自启：登录时由任务计划程序拉起（pythonw 静默无窗口）
    local pyw="${PYTHON_BIN%/*}/pythonw.exe"
    local run_py="$PYTHON_BIN"
    [ -f "$pyw" ] && run_py="$pyw"
    # 转成 Windows 路径（schtasks 不认 /c/... 形式）
    local win_py win_script
    win_py=$(cygpath -w "$run_py" 2>/dev/null || echo "$run_py")
    win_script=$(cygpath -w "$DAEMON_PY" 2>/dev/null || echo "$DAEMON_PY")
    if schtasks /Create /TN "$WIN_TASK_NAME" /TR "\"$win_py\" \"$win_script\"" /SC ONLOGON /F >/dev/null 2>&1; then
        echo "已注册登录自启任务: $WIN_TASK_NAME"
    else
        echo "WARNING: 自启任务注册失败（可能需要管理员权限），重启后需手动执行 bash manage.sh install"
    fi
}

do_uninstall_windows() {
    schtasks /Delete /TN "$WIN_TASK_NAME" /F >/dev/null 2>&1 && echo "自启任务已删除"
    stop_daemon
    echo "Windows 安装残留已清理"
}

# ── 通用命令 ──────────────────────────────────────────
do_status() {
    echo "=== 平台: $PLATFORM ==="
    echo ""
    echo "=== daemon 进程 ==="
    if is_running; then
        local pid
        pid=$(cat "$DAEMON_PID")
        echo "running, pid=$pid"
    else
        echo "未运行"
    fi
    echo ""
    echo "=== 端口文件 ==="
    if [ -f "$DAEMON_JSON" ]; then
        cat "$DAEMON_JSON"
    else
        echo "(无端口文件)"
    fi
    echo ""
    echo "=== /health ==="
    local port
    port=$(get_port)
    if [ -n "$port" ]; then
        local result
        result=$(curl -sS --noproxy '*' --max-time 2 "http://127.0.0.1:${port}/health" 2>&1) && echo "$result" || echo "(无法连接)"
    else
        echo "(无端口)"
    fi
}

do_restart() {
    # macOS：若 daemon 由 launchd 托管，走 kickstart 重启，避免退化为无守护的 nohup 进程
    if [ "$PLATFORM" = "macos" ] && launchctl print "gui/$(id -u)/${PLIST_NAME}" >/dev/null 2>&1; then
        launchctl kickstart -k "gui/$(id -u)/${PLIST_NAME}"
        sleep 1
        do_status
        return
    fi
    stop_daemon
    sleep 1
    start_daemon
}

do_logs() {
    echo "=== daemon.log (最后 30 行) ==="
    if [ -f "$DAEMON_LOG" ]; then
        tail -30 "$DAEMON_LOG"
    else
        echo "(无日志文件)"
    fi
}

# ── 主入口 ────────────────────────────────────────────
COMMAND="${1:-status}"

case "$COMMAND" in
    install)
        echo "=== 安装 daemon (平台: $PLATFORM) ==="
        case "$PLATFORM" in
            macos)    do_install_macos ;;
            linux)    do_install_linux ;;
            windows)  do_install_windows ;;
            *)        echo "不支持的平台: $PLATFORM"; exit 1 ;;
        esac
        ;;
    uninstall)
        echo "=== 卸载 daemon (平台: $PLATFORM) ==="
        case "$PLATFORM" in
            macos)    do_uninstall_macos ;;
            linux)    do_uninstall_linux ;;
            windows)  do_uninstall_windows ;;
            *)        echo "不支持的平台: $PLATFORM"; exit 1 ;;
        esac
        ;;
    status)  do_status ;;
    restart) do_restart ;;
    logs)    do_logs ;;
    *)       echo "用法: $0 {install|uninstall|status|restart|logs}"; exit 1 ;;
esac
