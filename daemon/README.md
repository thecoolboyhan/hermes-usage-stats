# Hermes Usage Stats — Daemon

> 用量统计数据服务。全平台支持（macOS / Linux / Windows），零第三方依赖。

## 这是什么

独立 Python 进程，读取 `~/.hermes/state.db`，对外暴露 HTTP 接口：

| 端点 | 说明 |
|---|---|
| `GET /health` | 健康检查，返回 `{"ok": true, "schema_version": N}` |
| `GET /insights` | 返回用量数据（默认 14 天） |
| `GET /insights?days=7` | 最近 7 天 |
| `GET /insights?days=30` | 最近 30 天 |

## 平台支持

| 平台 | 进程管理 | 说明 |
|---|---|---|
| **macOS** | `launchd` (user-level plist) | 重启后自动拉起 |
| **Linux** | `systemd --user` | 同上，需先运行 `systemctl --user enable --now hermes-usage-stats` |
| **Windows** | 后台进程（无等效 daemon） | `nohup python3 daemon.py` 后台运行 |

## 快速启动（不安装为服务）

```bash
python3 daemon.py
# 后台运行:
nohup python3 daemon.py >> daemon.log 2>&1 &
```

启动后端口动态分配，写入 `daemon.json`。默认端口范围：`18721–18999`。

## 手动安装为服务

### macOS

```bash
bash manage.sh install
```

### Linux (systemd)

```bash
bash manage.sh install
# 或手动:
mkdir -p ~/.config/systemd/user/
# manage.sh install 会自动生成 ~/.config/systemd/user/hermes-usage-stats.service
systemctl --user enable --now hermes-usage-stats
```

### Windows

```powershell
# PowerShell 后台启动
Start-Process -FilePath "python" -ArgumentList "daemon.py" -NoNewWindow -WindowStyle Hidden
```

## 运维命令

```bash
bash manage.sh status   # 查看 daemon 状态 + /health
bash manage.sh restart  # 重启 daemon
bash manage.sh logs     # 看 daemon.log
bash manage.sh uninstall # 停止 + 清理
```

## 数据来源

直接读取 Hermes 的 `state.db`（SQLite），不依赖 hermes-agent 代码：

```sql
-- 表: session_model_usage
-- 字段: session_id, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens
```

**设计原则**：daemon 与 hermes-agent **零耦合**（lsof 验证），Hermes 升级不影响用量统计。

## 故障排除

**症状：状态栏按钮点不开 / 数据停留在"加载中"**

1. `bash manage.sh status` — 查看 daemon 是否在运行、/health 是否正常
2. `bash manage.sh logs` — 查看 daemon 日志
3. `curl http://127.0.0.1:<端口>/health` — 手动验证
4. `bash manage.sh restart` — 重启 daemon

**症状：daemon 运行但 /health 无响应**

- 端口可能变了（动态分配）。`bash manage.sh status` 查看当前端口

**症状：Hermes 升级后数据不更新**

- 检查 `~/.hermes/state.db` 是否存在
- 检查 `curl http://127.0.0.1:<端口>/insights` 是否返回最新数据
- daemon 直读 db，不受 hermes-agent 升级影响

## 环境变量

| 变量 | 说明 | 默认值 |
|---|---|---|
| `HERMES_HOME` | Hermes 数据目录 | `~/.hermes`（macOS/Linux）、`%LOCALAPPDATA%\hermes`（Windows） |

```bash
# 自定义 Hermes 目录
HERMES_HOME=/opt/hermes python3 daemon.py
```
