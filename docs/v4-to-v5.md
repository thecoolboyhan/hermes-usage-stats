# v4 → v5 决策历史

## TL;DR

**v4 用 Hermes 内置 `host.request('insights.get')` 拿数据**——每次 Hermes 升级就崩，加补丁治标不治本。**v5 拆出独立 daemon 直读 SQLite**——彻底解耦，Hermes 升级不影响。

## v4：紧耦合方案（已废弃）

### 实现

```javascript
// plugin.js (v4)
const result = await host.request('insights.get', { days: 7 })
// → 走 Hermes gateway
// → gateway 调 agent/insights.py 的 get_insights()
// → 返回嵌套 JSON
```

### 失败模式

| 触发 | 结果 |
|---|---|
| Hermes 升级改 `methods_tools.py` | `insights.get` 找不到，RPC 返回 404 |
| Hermes 升级改 `insights.py` 内部结构 | 返回的 JSON shape 变了，插件渲染崩 |
| CLI server `--port 0` 改了 | desktop 发现不了端口，整个 RPC 卡死 |
| `host.request` transport 重连逻辑缺失 | socket 断后永不重连，永久白屏 |

### 修补方案（也没救）

加了 `_heal_insights.py` + `heal-insights-patch.sh`：
- `grep` 匹配固定字符串
- 升级后**每次**要重新打补丁
- 治标不治本——每次升级都是新问题

**结论**：v4 是**胶带**，不是方案。

## v5：解耦方案（当前）

### 核心设计

```
plugin.js ──fetch──> daemon.py ──sqlite3──> state.db
   (Hermes 内)        (独立进程)
```

| 决策 | 为什么 |
|---|---|
| **独立 Python daemon** | Python stdlib 零依赖，跨平台可移植 |
| **launchd 持久化** | macOS 用户登录就启动，崩溃自动重启 |
| **直读 state.db** | 不依赖 Hermes gateway / insights.py |
| **极薄 plugin.js** | 只从 SDK 取 7 个 UI 原子，Hermes SDK 变更影响面最小 |
| **端口动态 18721-18999** | daemon.json 写端口，plugin 端口扫描兜底 |

### 解耦证据

```bash
$ lsof -p <daemon_pid> | grep '\.py\|\.so'
# 输出全是 Python 3.9 stdlib 路径
# 没有 /Users/admin/.hermes/hermes-agent/ 下的任何文件
```

```bash
$ grep -rn 'hermes-agent' plugin/
$ grep -rn 'host.request' plugin/plugin.js
# 0 行（除注释说明）
```

### 对比表

| 维度 | v4 | v5 |
|---|---|---|
| 数据源依赖 | hermes-agent gateway | state.db（独立） |
| Hermes 升级影响 | 每次都崩 | 零影响 |
| 自愈机制 | heal 脚本 + 胶带 | 不需要（已解耦） |
| 启动依赖 | gateway + CLI server 必须活着 | daemon 必须活着 |
| 失败模式 | transport 重连失败永久白屏 | 3 次重试后显示安装提示 |
| 维护负担 | 每次升级手动打补丁 | 零 |

## 学到的教训

1. **"调一次远程 API"看似简单，长期看是高耦合炸弹**
   - v4 的 `host.request` 看上去就一行，但耦合了 hermes-agent 整个模块图
   - 一旦接口方重构，被调方就得跟着改

2. **补丁策略治标不治本**
   - v4 加了 3 层补丁（heal script / patch / transport retry）
   - 都没解决根本问题——只是把崩溃延后

3. **"独立进程 + 标准协议（HTTP）"是终极解耦**
   - daemon 暴露标准 HTTP，任何客户端都能用
   - hermes-agent 是 daemon 的零依赖（反过来不成立）
   - 这种"单向依赖"是健壮系统的标志

4. **零依赖是开源的最大卖点**
   - daemon 只用 `sqlite3` + `http.server` + `socketserver`
   - clone 即可跑，无需 pip install / npm install
   - 任何有 macOS 的人 30 秒就能验证

## 给后来者的建议

如果你想做一个类似 "Hermes X 工具"：

| 原则 | 实施 |
|---|---|
| **数据解耦** | 直读 state.db，不要调 `host.request` |
| **进程解耦** | daemon 用 launchd 持久化，不要依赖 Hermes 进程 |
| **代码解耦** | 你的 daemon 不 import 任何 hermes-agent 模块 |
| **接口解耦** | 暴露标准 HTTP/JSON，不要用私有协议 |
| **降级解耦** | 失败时给清晰提示，不要无限重试 |

记住：**你写的是独立工具，不是 Hermes 的扩展**。
