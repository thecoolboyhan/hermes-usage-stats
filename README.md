# Hermes Usage Stats

> **多模型混用场景的用量统计面板**。支持 macOS / Windows / Linux，与 Hermes Desktop 完全同步。

在 Hermes Desktop 状态栏展示 **📊** 按钮，点开是全页用量面板，按模型拆分 token / 会话 / 工具调用，支持 7 / 14 / 30 / 90 天切换。

[![macOS](https://img.shields.io/badge/macOS-12%2B-blue?style=flat-square)](https://github.com/thecoolboyhan/hermes-usage-stats)
[![Windows](https://img.shields.io/badge/Windows-10%2B-blue?style=flat-square)](https://github.com/thecoolboyhan/hermes-usage-stats)
[![Linux](https://img.shields.io/badge/Linux-Supported-blue?style=flat-square)](https://github.com/thecoolboyhan/hermes-usage-stats)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](LICENSE)

---

## 截图

```
┌─ Hermes Usage Stats ──────────────────────────────┐
│  📊 2026-09-24  用量概览（14天）                   │
│                                                    │
│  模型          对话次数   总消息数   总 Token 数  │
│  ─────────────────────────────────────────────   │
│  deepseek-v4    12        328       1,245,832    │
│  longcat-2.0     8        215         892,100    │
│  GLM-5.3         5        134         543,200   │
│  ─────────────────────────────────────────────   │
│  合计           25        677       2,681,132    │
│                                                    │
│  [近7天] [近14天] [近30天] [自定义]               │
└────────────────────────────────────────────────────┘
```

---

## 架构

```
┌──────────────────┐      ┌──────────────────────────────────┐
│  Hermes Desktop  │      │  用量 daemon (Python stdlib)       │
│                  │      │  (macOS: launchd / Linux: systemd) │
│  ┌────────────┐  │ HTTP │  ┌──────────────────────────┐    │
│  │ plugin.js  │──┼──────│  │ daemon.py               │    │
│  │(📊按钮+面板)│  │      │  │ · /health               │    │
│  └────────────┘  │      │  │ · /insights             │    │
│                  │      │  │ · 直读 ~/.hermes/state.db│    │
└──────────────────┘      │  └──────────────────────────┘    │
                          └──────────────────────────────────┘
```

**设计原则**：daemon 与 hermes-agent **零耦合**（lsof 验证），Hermes 升级不影响用量统计。

---

## 安装

### 前置要求

- **Hermes Desktop** v0.15+（[安装指南](https://github.com/NousResearch/hermes-agent)）
- Python 3.8+（macOS / Linux 自带）
- Windows: 需要 Python 3.8+（[python.org](https://python.org)）

### 一键安装

```bash
git clone https://github.com/thecoolboyhan/hermes-usage-stats.git
cd hermes-usage-stats
bash install.sh
```

Windows（PowerShell）:

```powershell
.\install.ps1
```

重启 Hermes Desktop，按 `⌘K`（macOS）/ `Ctrl+K`（Windows/Linux）→ Reload。

---

## 平台支持

| 平台 | daemon 进程管理 | 状态 |
|---|---|---|
| macOS 12+ | `launchd`（自动重启） | ✅ |
| Linux | `systemd --user`（自动重启） | ✅ |
| Windows 10/11 | 后台进程（手动重启） | ✅ |

详细安装说明见 [daemon README](daemon/README.md)。

---

## 常见问题

**Q: Hermes 升级后用量统计还能用吗？**
A: 能。daemon 直读 `state.db`，不依赖 hermes-agent 代码。

**Q: 支持哪些模型？**
A: 所有通过 Hermes Desktop 调用的模型（longcat、deepseek、GLM 等）。

**Q: 数据从哪里来？**
A: `~/.hermes/state.db`（Windows: `%LOCALAPPDATA%\hermes\state.db`）。

**Q: Windows 下如何开机自启？**
A: 可用 Task Scheduler 创建触发任务，指向 `python daemon.py`。详见 [daemon README](daemon/README.md#windows)。

---

## 组件

| 目录 | 说明 |
|---|---|
| `daemon/` | 独立 Python daemon，零依赖，直读 `state.db` |
| `plugin/` | Hermes Desktop 桌面插件 |
| `docs/` | v4→v5 迁移历史 |

详细文档：

- [daemon README](daemon/README.md) — HTTP 接口、运维命令、环境变量
- [plugin README](plugin/README.md) — 插件设计、SDK 依赖、v4→v5 迁移
- [docs/v4-to-v5.md](docs/v4-to-v5.md) — 决策历史与失败教训

---

## License

MIT © hanyongfa
