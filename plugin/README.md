# Hermes Usage Stats — Desktop Plugin

> Hermes Desktop 桌面端插件：状态栏 📊 按钮 + 全页用量面板。

## 这是什么

Hermes 桌面端的"用量统计"入口：
- **状态栏 chip**：`📊 用量` 按钮
- **全页路由**：`/#/usage-stats`
- **数据源**：独立 daemon（`daemon.py`），通过 HTTP `/insights` 获取数据

## 平台支持

✅ **全平台**（与 Hermes Desktop 保持一致）：

| 平台 | 支持状态 |
|---|---|
| macOS 12+ | ✅ |
| Windows 10/11 | ✅ |
| Linux | ✅ |

插件本身是纯 JavaScript，无平台相关代码。

## 安装

```bash
# 方法 1: 一键安装（推荐）
bash install.sh

# 方法 2: 手动
mkdir -p ~/.hermes/desktop-plugins/usage-stats/
cp plugin.js plugin.json ~/.hermes/desktop-plugins/usage-stats/
# 重启 Hermes Desktop，按 ⌘K → Reload
```

## 数据来源

独立 daemon（`daemon.py`），通过 HTTP `/insights` 获取数据。
不依赖 Hermes gateway 的 `insights.get` RPC 方法，**Hermes 升级不影响**。

详见 [`daemon/README.md`](../daemon/README.md)。

## 依赖

只从 `@hermes/plugin-sdk` 导入 7 个 UI 原子（Hermes 桌面端内置）：

```
cn, host, usePluginI18n, Button, Badge, Skeleton, ScrollArea
```

这些是 Hermes 团队维护的 SDK 契约，不随 hermes-agent 升级变化。

## 紧急回退

如果插件崩溃，按 ⌘K → Reload 无效：

```bash
# 1. 用备份覆盖
cp plugin.js.bak-20260903 ~/.hermes/desktop-plugins/usage-stats/plugin.js

# 2. 重启 Hermes Desktop
```

## v4 → v5 迁移记录

| 版本 | 日期 | 变化 |
|---|---|---|
| v5 | 2026-09-24 | daemon 从 `host.request('insights.get')` 改为独立 daemon 直读 `state.db`，彻底解除耦合 |
| v4 | 2026-09-10 | 加 transport 错误重试 3 次（1200ms 递增） |
| v4 | 2026-09-03 | 修 React hooks 崩溃（`useState` 条件调用） |

详见 [`docs/v4-to-v5.md`](../docs/v4-to-v5.md)。
