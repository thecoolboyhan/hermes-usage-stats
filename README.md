# Hermes Usage Stats

> Hermes Desktop 插件：多模型用量统计面板。

**支持多模型混用场景**——当你在同一个 session 里切换使用 longcat、deepseek、GLM 等多个模型时，统一计量的用量数据。

[![macOS](https://img.shields.io/badge/macOS-Required-blue.svg?style=flat-square)](https://github.com/thecoolboyhan/hermes-usage-stats)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](LICENSE)

---

## 截图

```
┌─ Hermes Usage Stats ──────────────────────────────┐
│                                                    │
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
┌──────────────────┐      ┌─────────────────────────┐
│  Hermes Desktop  │      │   macOS launchd          │
│                  │      │   (com.admin.hermes.      │
│  ┌────────────┐  │ HTTP │    usage-stats-daemon)   │
│  │ plugin.js  │──┼──────│  ┌──────────────────┐    │
│  │(📊按钮+面板)│  │      │  │ daemon.py        │    │
│  └────────────┘  │      │  │ (Python stdlib)  │    │
│                  │      │  │                  │    │
│                  │      │  │ · HTTP /health   │    │
│                  │      │  │ · HTTP /insights │    │
│                  │      │  │ · 直读 state.db  │    │
└──────────────────┘      │  └──────────────────┘    │
                          └─────────────────────────┘
```

**设计原则**：daemon 与 hermes-agent **零耦合**（lsof 验证），Hermes 升级不影响用量统计。

---

## 组件

| 目录 | 说明 |
|---|---|
| `daemon/` | 独立 Python daemon，直读 `~/.hermes/state.db`，`python3 daemon.py` 即可运行 |
| `plugin/` | Hermes 桌面端插件，cp 到 `~/.hermes/desktop-plugins/` 即可 |
| `install.sh` | 一键安装脚本 |

详细文档见各目录内的 `README.md`：

- **[daemon README](daemon/README.md)** — HTTP 接口、数据 schema、运维命令
- **[plugin README](plugin/README.md)** — 插件设计、SDK 依赖、v4→v5 迁移历史

---

## 安装

### 前置要求

- macOS（Hermes 桌面端专用）
- Python 3.8+（daemon，macOS 自带）

### 一键安装

```bash
git clone https://github.com/thecoolboyhan/hermes-usage-stats.git
cd hermes-usage-stats
bash install.sh
```

重启 Hermes 桌面端，按 `⌘K` → Reload。

---

## 常见问题

**Q: Hermes 升级后用量统计还能用吗？**
A: 能。daemon 直读 `state.db`，不依赖 hermes-agent 代码。

**Q: 支持哪些模型？**
A: 支持所有通过 Hermes 桌面端调用的模型（longcat、deepseek、GLM 等）。

**Q: 数据从哪里来？**
A: `~/.hermes/state.db`（Hermes 自身存储的会话数据）。

**Q: 面板点不开怎么办？**
A: 见 [daemon README 故障排除章节](daemon/README.md#故障排除)。

---

## License

MIT © hanyongfa
