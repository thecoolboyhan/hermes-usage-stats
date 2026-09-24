# Usage Stats Plugin (Hermes Desktop)

> 状态栏 **📊** 按钮 + 全页用量面板。Hermes 桌面端插件。

## 这是什么

Hermes 桌面端的"用量统计"入口：
- **状态栏 chip**：`📊 用量` 按钮
- **全页路由**：`/#/usage-stats`
- **数据源**：见 `~/.hermes/plugins/usage-stats/AGENTS.md`（独立 daemon，**不依赖** Hermes gateway）

## v5 关键变化（2026-09-24 重写）

| 维度 | v4（已删） | v5（当前） |
|---|---|---|
| 数据获取 | `host.request('insights.get')` → gateway | `fetch('http://127.0.0.1:<port>/insights')` → 独立 daemon |
| Hermes 升级影响 | ❌ `methods_tools.py` / `insights.py` 重写就坏 | ✅ 完全无影响（daemon 解耦） |
| 启动依赖 | gateway / CLI server 必须活着 | 仅 daemon 必须活着 |
| 失败模式 | 3 次重试后白屏 + heal 脚本 | 3 次重试后显示安装提示 |
| 自愈机制 | `patches/heal-insights-patch.sh` 胶带 | 无需（daemon 持久化 + 端口写文件） |

## 文件清单

| 路径 | 用途 |
|---|---|
| `plugin.js` | 插件源码（~26KB，~670 行）。**唯一会改的文件** |
| `plugin.json` | plugin manifest（id、entry、permissions） |
| `plugin.js.v4-bak` | v4 旧版备份（**保留作 emergency fallback**，不要删） |
| `plugin.js.bak-20260903` | 09-03 修复版备份（也保留） |

## plugin.js 结构（高层）

```
imports (cn, host, usePluginI18n, Button, ...)
  │
  ├─ DiagBoundary             # React error boundary，崩溃时输出到 console
  ├─ formatTokens / Duration / Date
  ├─ fetchDaemonJSON(path)    # 端口扫描 18721-18999（不依赖 daemon.json）
  │
  ├─ UsagePane               # 主面板
  │    ├─ OverviewCards
  │    ├─ ModelsSection      # 12 色 bar（绿/紫/橙/红/蓝/青/深橙/棕/靛/粉/青绿/黄）
  │    ├─ PlatformsSection
  │    ├─ ToolsSection
  │    ├─ SkillsSection
  │    ├─ ActivitySection    # 24 小时热力
  │    └─ DailyUsageChart    # SVG 折线图，按模型拆分
  │
  └─ UsageChip               # 状态栏按钮，onClick → host.navigate('/usage-stats')

export default { id, version: '5.0.0', register(ctx) {...} }
```

## SDK 依赖（最薄）

plugin.js 只从 `@hermes/plugin-sdk` 拿 **7 个东西**：

| Import | 用途 | 升级风险 |
|---|---|---|
| `cn` | className 合并 | 极低 |
| `host` | 仅 `host.navigate(path)` | 极低 |
| `usePluginI18n` | i18n hook | 低 |
| `Button` | UI 原子 | 低 |
| `Badge` | UI 原子 | 低 |
| `Skeleton` | 加载占位 | 低 |
| `ScrollArea` | 滚动容器 | 低 |

**Hermes 升级 SDK 时**：99% 不会动这 7 个名字。万一改了：
1. 改 import 即可（30 秒）
2. 不需要碰 daemon
3. 不需要碰其他模块

## 数据获取流程

```
plugin 加载
  ↓
UsagePane 挂载
  ↓
fetchDaemonJSON('/insights?days=7')        # 端口扫描 18721-18999
  ↓
daemon 直读 state.db → 返回 JSON
  ↓
setData → React 重渲染
```

**端口协商策略**（为什么不用读 `daemon.json`）：
- 端口扫描 18721-18999，~180 个端口 × 600ms timeout
- 实际场景端口固定，命中第一个就返回（< 1ms）
- daemon 死了/端口换 → 自动扫下一个
- 完全不需要在 plugin 和 daemon 之间维护协调文件

## 失败处理

| 情况 | 行为 |
|---|---|
| daemon 健康 | 1 次 fetch 成功，< 100ms 返回 |
| daemon 启动中 | 端口扫描无响应 → 自动重试 3 次（1s/2s/3s） |
| daemon 死了 | 3 次后显示错误页 + 安装提示 |
| 端口换了 | 扫描自动覆盖 |
| 数据空 | 显示"暂无数据"（不报错） |
| 组件崩溃 | DiagBoundary 捕获，console 输出 `RENDER ERROR`，UI 显示最小错误信息 |

## 修改指引

### 改了 daemon 返回字段

plugin.js 里有 `ov.total_sessions` 等字段访问。新增字段直接加即可；
删除字段需要：
1. 在 `UsagePane` 加 fallback（`(data.foo || [])`）
2. **同步改 `schema_version`**（plugin 里硬编码检查）

### 改了 UI

- **新增区块**：在 `UsagePane` 的 `hasData && jsxs(...)` 里加一个 `<XxxSection />`
- **改配色**：编辑顶部的 `MODEL_COLOR_POOL = ['#4CAF50', '#9C27B0', '#FF9800', '#F44336']`
- **改默认 days**：编辑 `useState(7)` → `useState(14)`

### 添加语言

在 `ctx.i18n.register({ en: {...}, zh: {...} })` 里加。缺 key 自动 fallback 英文。

### 紧急回退

如果新 plugin.js 有 bug：
```bash
cp ~/.hermes/desktop-plugins/usage-stats/plugin.js.v4-bak \
   ~/.hermes/desktop-plugins/usage-stats/plugin.js
# 然后 Hermes 桌面 ⌘K → Reload
```
（v4 依赖 gateway，但 gateway 通常活着；临时回退可用）

## 调试

### console 看 daemon 请求

打开 Hermes devtools（如果开启了），搜 `[usage-stats]`：
- `USAGE-PANE MOUNTED` → 面板挂载
- `daemon result: schema_v=N sessions=M` → 数据返回成功
- `daemon fetch fail, retry N/3` → 重试中

### 手动测 daemon

```bash
curl http://127.0.0.1:$(jq -r .port ~/.hermes/plugins/usage-stats/daemon.json)/insights?days=7 | jq .
```

## 历史

- **v1** (2026-09-03)：初版用 `host.request('insights.get')`，**每次 Hermes 升级就坏**
- **v2-v4** (2026-09-03 ~ 09-14)：加 `_heal_insights.py` + `heal-insights-patch.sh` 补丁
  - 用 grep 匹配固定字符串
  - 每次升级都要重新打补丁
  - **已彻底删除**（见 `~/.hermes/patches/` 已被清空）
- **v5** (2026-09-24)：重写为**独立 daemon + 极薄 plugin**，Hermes 升级零影响
