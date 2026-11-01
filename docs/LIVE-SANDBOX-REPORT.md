# C3 实施报告：Live Sandbox

| 项 | 值 |
| --- | --- |
| 阶段 | C3 |
| 依赖 | C2（沙盒创建房间时要带规则选项） |
| 结论 | 已实现、已测试：真实房间 + 真实规则 + 真实投影，单页切换席位；生产环境服务端硬拒绝 |

## 1. 实际完成的功能

### 1.1 架构：不复制规则

```text
/dev/sandbox（仅 astro dev 注入）
      │  POST /api/v1/dev/sandbox/rooms
      ▼
Worker 沙盒路由（ENVIRONMENT !== production && SANDBOX_ENABLED === "true"）
      │  真实房间：/create（sandbox: true）→ /sandbox/seed（写入 N 个席位）
      ▼
真实 Durable Object（GoRoom / GomokuRoom / DoudizhuRoom / …）
      │  /sandbox/view?playerId  → buildClientView()（浏览器投影）
      │  /agent/action           → dispatchAction()（真实规则与回执）
      ▼
浏览器：clientViewContract 校验 → 同一个 GameBoard
```

- 没有任何游戏规则被复制到浏览器；棋盘组件是产品自带的 `GameBoard`。
- 行动走的是既有的 `/agent/action` → `dispatchAction()` → `plugin.applyAction()`，因此合法性与日志与真实对局完全一致。
- 不使用预置 Fixture 掩盖服务端问题：投影不符合前端契约时页面会显式报错并列出字段路径。

### 1.2 安全模型（三层，全部在服务端）

| 层 | 检查 | 结果 |
| --- | --- | --- |
| Worker 路由 | `sandboxEnabled(env)` | 不满足则**整个路由 404** |
| 房间创建 | `sandbox: true` 且 `sandboxEnabled` | 否则 404，房间不会被标记 |
| 房间端点 | `sandboxMode && sandboxEnabled` | 否则 `/sandbox/*` 404 |

`ENVIRONMENT=production` 时，即使 `SANDBOX_ENABLED=true` 也返回 false；生产配置两个变量都不提供。

已核实：
- `pnpm build:all` 的生产产物中**没有** `/dev/sandbox` 页面（`find dist -path "*dev/sandbox*"` 为空）。
- `apps/workers/wrangler.json`（开发）显式写入 `ENVIRONMENT=development`、`SANDBOX_ENABLED=true`；`wrangler-prod.json` / `wrangler-prod.example.json` 均不含这两项。

### 1.3 席位与旁观

- 沙盒房间预置 N 个席位（`sandbox-seat-1…N`，名称 `Sandbox 1…N`）+ 一个**真实旁观席位** `sandbox-spectator`。
- 旁观视角来自 `buildClientView("sandbox-spectator")`，不是"隐藏几个面板假装观战"。
- 切换席位 = 换 `playerId` 重新取一次投影；棋盘随之切换（斗地主会显示该席位自己的 17 张牌）。

### 1.4 页面能力

顶部：游戏选择、席位数（2–6）、该游戏的规则选项、创建 / 重开 / 开始对局。
中部：`GameBoard`（真实棋盘）。
右侧：当前操作席位、阶段、回合、合法行动、最近事件、完整服务端投影 JSON。
错误区：请求错误、协议不符（列出 `path (code)`）。

### 1.5 与 design-preview 的区别

| | design-preview | Live Sandbox |
| --- | --- | --- |
| 数据 | 手写 fixture | 真实 DO 状态 |
| 规则 | 无 | 真实 `GamePlugin` |
| 行动 | 无 | 真实 `dispatchAction` |
| 持久化/恢复 | 无 | 有（房间即生产房间） |
| 用途 | 视觉验收 | 规则与协议联调 |

## 2. 代码变更

新增：

```text
apps/workers/src/lib/sandbox.ts                 44 行   部署闸门 + 席位命名
apps/workers/src/api/sandbox.ts                211 行   创建 / 视图 / 行动 / 事件代理
apps/web/src/dev/Sandbox.tsx                   377 行   沙盒页面
apps/web/src/dev/sandbox.css                   199 行   页面样式（仅设计令牌）
apps/web/astro/dev/sandbox.astro                 8 行   仅 dev 注入的页面壳
apps/workers/src/tests/platform/Sandbox.test.ts 316 行   13 条用例
```

修改：

| 文件 | 改动 |
| --- | --- |
| `BaseGameRoom.ts` | `sandboxMode` 标记（含恢复）；`/create` 识别 `sandbox: true`；`/sandbox/seed`、`/sandbox/view`、`/sandbox/events` |
| `api/routes.ts` | 挂载 `/dev/sandbox`（在鉴权分组之外，自带闸门） |
| `apps/workers/src/types.ts` | `Env.ENVIRONMENT`、`Env.SANDBOX_ENABLED` |
| `apps/workers/wrangler.json` | 开发环境开启这两个变量 |
| `apps/web/astro.config.mjs` | dev 模式注入 `/dev/sandbox` |
| `apps/web/src/i18n/locales/*` | 20 条沙盒文案（中英成对） |

## 3. 新增接口

```text
POST /api/v1/dev/sandbox/rooms   { gameType, players?, options? }
     -> { roomId, roomCode, gameType, options, seats: [{ id, name }] }
GET  /api/v1/dev/sandbox/view    ?roomId&playerId  -> { state }        // 浏览器投影
POST /api/v1/dev/sandbox/action  { roomId, playerId, actionType, data? }
GET  /api/v1/dev/sandbox/events  ?roomId           -> { events: [{ seq, at, type, summary? }] }

DO 内部：POST /sandbox/seed、GET /sandbox/view、GET /sandbox/events
```

## 4. 测试命令与结果

```bash
pnpm --filter @llmgames/workers exec vitest run src/tests/platform/Sandbox.test.ts
# 13 passed
pnpm --filter @llmgames/workers test    # 104 files / 928 passed, 2 skipped（C2 后 915 + 13）
pnpm --filter @llmgames/web test        # 15 files / 575 passed
pnpm lint                               # oxlint / eslint / CSS 令牌 / 严格类型 / AI spec
pnpm build:all                          # 6 tasks successful
```

覆盖点：

| 需求 | 用例 |
| --- | --- |
| 生产不可访问测试特权 | `is off in production even when the flag is set`、`refuses to create a sandbox room in production` |
| 非沙盒房间不可用 | `keeps the sandbox endpoints closed on a room created without the flag` |
| 部署降级后立即失效 | `closes the sandbox endpoints when the deployment stops allowing them`（同一 storage，换成生产 env 唤醒） |
| 真实 GamePlugin 规则 | `plays a legal move and records it`、`reports an illegal move as a rejection` |
| 各席位视角 | `returns each seat's own projection`（恰好一个席位可落子；旁观只有 `leave`） |
| 状态隐私 | `hides the other seats' cards in a three-seat card game`（两块手牌不同、`hands` 从不投影、旁观 `hand` 为空但 `handCounts` 可见） |
| 前端协议校验 | `carries the fields a room page reads`、`keeps the waiting room renderable before the match starts`（与 M4 的卡大厅问题同源） |
| 终局 / 重开 | 通过重建房间实现（页面「重开对局」）；终局由真实规则驱动，见 C4 报告中的完整对局用例 |

## 5. 可复现路径（已实际验证前两步）

```bash
pnpm dev                       # web:3000，workers:6787
open http://localhost:3000/dev/sandbox
```

1. 选择 `gomoku`、2 席 → 「创建测试局」→ 顶部出现房间码，棋盘出现。
2. 点击「开始对局」→ 右侧显示阶段 `play`、一个席位有 `place_stone`。
3. 在席位列表切换 → 再落子，棋盘与合法行动随席位变化。
4. 选择 `doudizhu`、3 席 → 三个席位各自只看到自己的 17 张牌；切到「旁观」时手牌为空、只显示张数。
5. 生产构建核验：`pnpm build:all && find dist -path "*dev/sandbox*"` → 无输出。

已在本环境实测：`npx astro dev --port 4321` 后 `GET /dev/sandbox` 返回 200，页面标题 `Live sandbox`（日志 `[200] /dev/sandbox 122ms`）。未做浏览器截图（本环境无可用浏览器会话）。

## 6. 性能影响（实测）

| 指标 | C2 后 | C3 后 | 差 |
| --- | --- | --- | --- |
| Worker 上传体积 | 17678.67 KiB | 17689.62 KiB | **+10.95 KiB** |
| Worker gzip | 4204.11 KiB | 4206.57 KiB | **+2.46 KiB** |

- 生产前端产物不增加任何沙盒代码（路由不注入，`Sandbox.tsx` 只被 dev 页面引用；生产 chunk 中不存在）。
- 沙盒每个操作是一次 DO HTTP 往返，与真实房间同量级。

## 7. 旧版本兼容

| 项 | 处理 |
| --- | --- |
| 生产行为 | 沙盒路由在未开启部署上 404，其余接口不变 |
| `Env` 类型 | 两个变量均可选；不配置即视为关闭 |
| 房间存储 | 仅多一个 `sandboxMode` 布尔键；旧房间读取为 `false` |
| `restorePersistedRoom` | `sandboxMode` 与既有三个读取合并进同一个 `Promise.all`，**不增加恢复路径的 await 次数**（见第 8 节） |
| 生产构建 | 不生成 `/dev/sandbox` 页面 |

## 8. 已知问题与未完成事项

**已实现、已测试**：第 1、4 节全部内容。

**过程中发现并修复的真实回归**：

- 最初把 `sandboxMode` 的读取写成 `restorePersistedRoom` 里一个独立的 `await`，导致恢复路径多一个微任务。`PokerRoom.restart.test.ts`（依赖"重建后立刻可读"的时序）因此失败。已改为与既有读取合并到同一个 `Promise.all`，测试恢复通过。这条记录保留，因为它说明该测试对恢复时序敏感，后续改动应避免在恢复路径增加 await。

**已实现、未在本环境演练**：

- 浏览器内的实际点击流程（无可用浏览器会话）。页面加载已用 `astro dev` + `curl` 验证；席位切换、行动、终局需要浏览器或 Playwright，步骤见第 5 节。
- 斗地主完整对局（叫地主 → 出牌 → 终局）在沙盒中的端到端演练。测试覆盖了私牌隔离与开局，但完整对局需要连续多手操作。

**暂缓**：

- 固定随机种子、动作序列保存/回放、导出 Fixture、自动跑规则 Bot（原计划中的"可选增强"）。
- Agent Rich / Compact 双视图对照面板：目前只展示服务端浏览器投影与事件流；`buildAgentView` 的紧凑视图对照留待后续（需要再加一个只读端点）。

## 9. 后续可选增强

1. 增加 `GET /sandbox/agent-view?playerId=` 做 Rich/Compact 对照，配合现有 `compactState`。
2. 让沙盒支持"固定种子 + 动作脚本重放"，用于回归。
3. 沙盒内一键导出脱敏 Fixture（去掉 playerId 与时间戳），供 design-preview 使用。
