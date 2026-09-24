# 用量统计 Daemon

> **AGENTS 提示**：用量面板的**数据源**。Hermes 更新不会影响这里，但需要运维。

## 这是什么

独立 Python 进程，对外暴露 HTTP 接口 `/health` 和 `/insights?days=N`，
供 `~/.hermes/desktop-plugins/usage-stats/plugin.js` 调用。

**设计目标**：让"用量面板"按钮**不依赖** Hermes 升级 / gateway 状态 / `host.request`。
哪怕 `~/.hermes/hermes-agent/` 整个目录被重写，daemon 仍能工作。

## 文件清单

| 路径 | 用途 |
|---|---|
| `daemon.py` | 主程序。stdlib only（`sqlite3` + `http.server`），零第三方依赖 |
| `daemon.json` | 运行时状态：`{pid, port, schema_version, started_at}`，供 plugin 读端口 |
| `daemon.pid` | 当前 PID（启动时写，停时删） |
| `daemon.log` | 业务日志（HTTP 访问、查询耗时） |
| `manage.sh` | 安装/卸载/状态/重启 launchd 任务 |
| `launchd/com.admin.hermes.usage-stats-daemon.plist` | launchd 配置 |

## 安装 & 运维

```bash
# 安装（首次，或重装）
bash ~/.hermes/plugins/usage-stats/manage.sh install

# 卸载（保留数据，停止 launchd）
bash ~/.hermes/plugins/usage-stats/manage.sh uninstall

# 查看状态（PID / 端口 / 健康）
bash ~/.hermes/plugins/usage-stats/manage.sh status

# 重启（不会丢 launchd 注册）
bash ~/.hermes/plugins/usage-stats/manage.sh restart
```

## HTTP 接口

| 路径 | 方法 | 说明 |
|---|---|---|
| `/health` | GET | 健康检查，返回 `{ok, schema_version}` |
| `/insights?days=N` | GET | 主数据接口，`N` ∈ {7,14,30,90} |
| `/ready` | GET | readiness probe（launchd 用） |

### 返回结构（`/insights`）

```json
{
  "schema_version": 2,
  "generated_at": 1758672000,
  "overview": {
    "total_sessions": 261,
    "total_messages": 3643,
    "total_tool_calls": 5432,
    "total_tokens": 18508367,
    "total_input_tokens": 14800000,
    "total_output_tokens": 3708367,
    "total_cache_read_tokens": 0,
    "total_hours": 12.5,
    "avg_session_duration": 1800,
    "date_range_start": 1758067200,
    "date_range_end": 1758672000
  },
  "models": [{"model": "laguna-xs-2.1:free", "sessions": 50, "total_tokens": 1.2e7, ...}],
  "platforms": [{"platform": "nous", "sessions": 200, "total_tokens": 1.5e7}],
  "tools": [{"tool": "terminal", "count": 10487, "percentage": 65.2}, ...],
  "skills": {"summary": {...}, "top": [...]},
  "activity": {"active_days": 7, "max_streak": 7, "by_hour": [0,0,0,...24 hours]},
  "daily_usage": [{"date": "2026-09-18", "date_label": "09/18", "models": {...}}, ...]
}
```

## 数据源

- 直读 `~/.hermes/state.db`（SQLite）
- 三个核心表：`sessions`, `messages`, `session_model_usage`
- `tool_calls` 是 JSON 字符串字段——daemon 解析 `function.name`
- **不导入**任何 `~/.hermes/hermes-agent/` 下的代码（已 lsof 验证）

## 常见问题排查

### 1) daemon 没起来

```bash
bash ~/.hermes/plugins/usage-stats/manage.sh status
# 显示 "launchd task not loaded" → 重新 install
# 显示 "daemon not running" 但 plist loaded → launchd 没拉起，看日志
```

**日志位置**：
- `~/.hermes/plugins/usage-stats/launchd/stdout.log`
- `~/.hermes/plugins/usage-stats/launchd/stderr.log`

```bash
tail -50 ~/.hermes/plugins/usage-stats/launchd/stderr.log
```

### 2) 端口被占

daemon 启动时随机选 18721-18999，写入 `daemon.json`。如果手测时占用了：
```bash
# 找占用进程
lsof -nP -iTCP:18721-18999 -sTCP:LISTEN
```

### 3) 数据不对

daemon 不缓存结果，每次查询实时 SQL。如果 `state.db` 损坏：
```bash
sqlite3 ~/.hermes/state.db "PRAGMA integrity_check"
```

### 4) Hermes 升级后出问题

**daemon 不依赖 hermes-agent，应该不受影响。** 如果出问题：

```bash
# 1) 确认 daemon 还活着
curl http://127.0.0.1:<port>/health
# 2) 确认 launchd 任务还加载
launchctl list | grep usage-stats
# 3) 重启 daemon
bash ~/.hermes/plugins/usage-stats/manage.sh restart
```

## 升级 daemon.py

1. 编辑 `daemon.py`
2. **如果改了 HTTP 接口或 schema**：同步更新 `~/.hermes/desktop-plugins/usage-stats/plugin.js` 的 `fetchDaemonJSON` 和 UI 字段映射
3. **如果只是修 bug / 优化查询**：直接 restart
4. **如果改了 schema_version**：必须同步改 plugin.js 里的兼容判断（当前 plugin 假设 `schema_version: 2`，字段缺失就 fallback）

## 历史

- **2026-09-24**：v1 上线，替换 v4（gateway RPC + `_heal_insights.py` 补丁方案）
- 取代了"每次 Hermes 升级按钮就坏"的问题
