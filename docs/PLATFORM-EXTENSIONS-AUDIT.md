# 平台四项能力扩展：源码审计

审计对象：`llmgames-online`（`https://github.com/greyair/llmgames-online`）。

| 项 | 值 |
| --- | --- |
| 审计时本地 HEAD | `a4b51fdf068911f5c1a964d4a4843d60d21e74a7` |
| 审计时 `origin/main` | `a4b51fdf068911f5c1a964d4a4843d60d21e74a7`（与本地一致，无需同步） |
| 工作树 | 干净（`git status --short` 无输出） |
| 分支 | `main` |
| 基线测试 | `@llmgames/workers` 99 文件 / 855 用例通过，2 跳过，约 135s |

本地与 GitHub 完全一致，审计就地开始，没有未提交改动需要保护，也没有可拉取的更新。

## 1. 现有架构（已核实）

```text
packages/game-catalog/src/manifest.ts   GAME_MANIFESTS：16 款游戏的描述性元数据
packages/game-catalog/src/index.ts      GameTypeId、GAME_ACTIONS、GAME_LIFECYCLE、房间生命周期常量
apps/workers/src/games/contract.ts      GamePlugin<TState>：createInitialState / start / applyAction / projectState / agentFields / agentDecision
apps/workers/src/games/registry.ts      显式静态注册 16 个插件
apps/workers/src/games/<id>/plugin.ts   规则模块（纯函数，副作用用 GameEffect 描述）
apps/workers/src/durable-objects/BaseGameRoom.ts   （5677 行）平台层：席位、WS、时钟、幂等回执、持久化、归档、回放、Jev
apps/workers/src/durable-objects/types.ts          状态与配置类型
apps/workers/src/mcp/createServer.ts    （1433 行）远程 MCP 工具面：agent_claim / room_create / room_join / get_state / wait_for_turn / send_action
apps/workers/src/api/rooms.ts           浏览器创建/加入房间路由（Zod strict schema）
apps/web/src/interface/Room.tsx         房间外壳：入口、MatchDesk、LobbySetup、回放
apps/web/src/game-ui/MatchDesk.tsx      共享比赛框架（顶栏、玩家条、棋盘槽）
apps/web/src/game-ui/LobbySetup.tsx     大厅：席位、投递、邀请、开始
apps/web/src/domain/game-state.ts       clientViewContract：`.catchall(wireValueSchema)`，新增字段不会拒帧
```

关键事实（决定后续实现方式）：

1. **房间配置解析只有一个入口**：`BaseGameRoom.parseRoomCreationConfig()` 从 `/create` 请求体读取 `hostId`、`hostName`、`maxPlayers`、`gameTotalTime`、`turnTime`、`roomCode`，其余字段一律忽略。浏览器与 MCP 两条创建链路各自把请求体转发到这个入口。
2. **DO 具备 SQLite**：`historySql()` 已经用 `CREATE TABLE IF NOT EXISTS` 维护 `game_events`、`rewatch_frames`，并能在测试 shim（`MemoryRoomRuntime` 无 `sql`）下退化为内存数组。聊天可以复用同一机制，不必新增存储绑定。
3. **幂等回执已有成熟模型**：`AckedActionResult` + `ACTION_RESULT_TTL_MS`（5 分钟）+ `ACTION_RESULT_MEMORY`（64 条），随 `gameState` 一次写入。聊天的 `requestId` 需要另一套（按消息条数计），不能挤占 action 回执配额。
4. **`clientViewContract` 是 catchall**：M4.6.1 的"卡大厅"问题已用 `.catchall(wireValueSchema)` 修复，新增协议字段不会导致整帧被丢弃。
5. **MCP 身份链**：`controllerId`（私有）→ `mcp_agent_seats`（私有 agentId）→ `mcp_room_players`（房间级公开 `playerId`）。所有房间内操作都以 `playerId` 进行，`agentId` 不出 Worker。
6. **`wait_for_turn` 的等待器是进程内 Promise + setTimeout**（`TurnWaiter`），最多 30s，没有 DO alarm 参与。聊天不接入这套等待器，避免给每个 agent 增加常驻任务。
7. **流媒体已退役**：`broadcastAllowed` 恒为 false，`/broadcast*` 拒绝。新增功能不得重新引入广播许可。
8. **`handleGameAction` 是纯委派**：16 个房间适配器都只是 `plugin.applyAction()` + `applyGameEffects()`，因此 Bot 行动只要走 `dispatchAction` 就自动满足服务端权威校验。

## 2. 四项功能现状

### C1 房间聊天

| 检查项 | 结论 |
| --- | --- |
| 现有聊天实现 | **不存在**。`apps/**` 中没有 chat 模块、没有聊天表、没有 `chat_*` 协议消息。 |
| 现有消息通道 | WS：`action` / `join` / `leave` / `start_game` / `rewatch_saved` / `timer_sync`。无自由文本通道。 |
| MCP 工具 | 12 个工具，无任何聊天工具。instructions 中明确要求 agent **静默**（"SILENT PLAY"），这是需要更新的过时约束。 |
| 可复用 | `BaseGameRoom.broadcast()`、`isRoomMember()`、`ensureSpectators()`、`buildAgentRoomMembers()`（可信的成员显示名解析）、`historySql()` 的建表模式。 |
| 必须新增 | 聊天存储与序号、限流、幂等、WS 协议、`/agent/chat`、两个 MCP 工具、前端组件。 |

结论：**从零实现，但完全落在既有房间 DO 内部**，不新建 ChatRoom。

### C2 游戏规则选项

| 检查项 | 结论 |
| --- | --- |
| 现有选项 | 只有通用项：`maxPlayers`、`gameTotalTime`、`turnTime`（外加 `rooms.ts` 里已被 `strict` 拒绝的 `minBet`/`maxBet` 等残留键）。 |
| 游戏专属选项 | **不存在**。`GameRoomConfig` 无 `options` 字段。 |
| Go 棋盘尺寸 | `GO_DEFAULT_SIZE` 常量贯穿 rules/agent/前端；`state.boardSize` 已经是一等字段，`cells` / `playedAt` / `legal` / 计分全部按 `boardSize` 计算 —— **改造成本低，只需在初始化时取值**。 |
| Aeroplane 起飞规则 | `DEFAULT_TAKEOFF = [6]`，`state.takeoff` 已是一等字段，`rules.ts` 用 `table.takeoff.includes(roll)` 判定，并且已支持多元素提示文案。 |
| Monopoly 轮数 | `state.rounds` 已由 `nextTurn()` 维护（`turns / alive`），但**没有任何轮数上限**，也没有轮数结算。需要新增终止条件 + `richest()` 结算（函数已存在）。 |
| 可复用 | `parseRoomCreationConfig`（单点解析）、`rooms.ts` 的 Zod schema、MCP `room_create` 的 inputSchema、`GAME_MANIFESTS`（单一权威元数据表）。 |
| 兼容性 | 旧房间状态若缺选项字段，插件必须能回落到历史默认值（9 路 / 6 起飞 / 无轮数上限）。 |

结论：选项契约放在 `packages/game-catalog`（Web 与 Workers 共享），解析与校验在服务端单点执行。

### C3 Live Sandbox

| 检查项 | 结论 |
| --- | --- |
| 现有调试设施 | `apps/web/src/dev/` 是**静态** design-preview：手写 fixture、无服务端、无真实规则。 |
| 路由 | `astro` 静态构建 + `getStaticPaths`（`STATIC_PAGE_PATHS`）；`/design-preview*` 仅在 `command === "dev"` 时通过 `injectRoute` 注入。**这正是 sandbox 该走的路径。** |
| 真实规则可复用性 | 规则在 `apps/workers/src/games/**`，浏览器不能直接 import（跨 app 边界 + Workers 依赖）。因此必须通过 Worker/DO 调用真实插件，而不是在浏览器复制规则。 |
| 席位模拟能力 | 现有 `/agent/action` 与 `/agent/view` 只按 `playerId` 鉴权（内部端点，仅 Worker 可达）。因此"切换席位"只需**创建一个含多个已知 playerId 的房间**，不需要在生产代码里加入任意身份冒充。 |
| 危险点 | 若把"任意 playerId 代打"做成公开 API，就是生产身份绕过。必须：(a) 房间创建时打上 sandbox 标记；(b) 端点要求 `env.ENVIRONMENT !== "production"` 且显式 `SANDBOX_ENABLED`；(c) 生产 wrangler 配置不提供该变量。 |
| 必须验证 | `GamePlugin → 真实投影 → clientViewSchema → GameBoard` 全链路（M4 曾出现 `start_game` 成功但前端 Zod 拒帧导致卡大厅）。 |

结论：sandbox = dev-only 的"创建多席位测试房"+"代理行动"网关 + 复用 `GameBoard` 的调试页面。规则零复制。

### C4 免费规则 Bot

| 检查项 | 结论 |
| --- | --- |
| 现有 Bot | **没有** Rule Bot。`Jev` 是托管模型（需 `TYPESAFE_API_KEY`），不是规则 Bot。 |
| 席位类型 | `Player` / `BasePlayerInfo` 有 `isAgent`、`channel: "browser" | "mcp"`、`hostedAgent: "jev"`。Bot 需要一个**独立标记**，不能伪装成 MCP agent（否则会污染 MCP 身份表与观战/回放语义）。 |
| 行动注入点 | `dispatchAction(player, payload, sendErrors, ack)` 已经完成"房间成员校验 → 计时结算 → 插件 applyAction → 持久化 → 广播 → 回执"。Bot 必须走它，不得直接改状态。 |
| 调度 | 现有 alarm 唯一入口是 `scheduleNextRoomAlarm()`，它已经在 `Math.min` 中合并了房间到期、计时截止、Jev 决策。Bot 只能加入这个 `Math.min`，不得另设 alarm。 |
| 风险 | 同步递归（一回合连走 N 步）会耗尽 CPU；必须"一次 alarm 里有限步数 + 重新武装 alarm"。 |
| 可复用 | `buildAgentView(playerId)`（已经是"该席位投影"）、`gamePluginFor()`、`TurnWaiter`/`recordEvent` 日志链路。 |
| 策略参考 | West Window 的 gomoku/reversi 启发式（MIT, SerenQi）。只借鉴思路与评分数值，不整体搬运其引擎。 |

结论：策略挂在 `GamePlugin` 的可选 `ruleBot` 字段；席位生命周期、调度、权限、日志由平台负责。

## 3. 可以复用的接口（清单）

| 能力 | 复用点 |
| --- | --- |
| 房间成员判定 | `BaseGameRoom.isRoomMember()` / `isSpectator()` |
| 可信显示名 | `buildAgentRoomMembers()` / `playerPrimaryName()`（前端） |
| 受信投影 | `buildClientView(playerId)` / `buildAgentView(playerId)` |
| 状态持久化 | `saveState()`（一次写入 `gameState` + 回执 + 目录修复标记） |
| SQLite 建表 | `historySql()` + `transactionSync()` 模式 |
| 幂等 | `actionFingerprint()` / `canonicalJson()` |
| MCP 身份 | `requireAgentController()` / `requireAgentRoomPlayer()` |
| 房间创建 | `parseRoomCreationConfig()` + `rooms.ts` / `room_create` 两条链路 |
| 调试路由 | `astro.config.mjs` 的 `injectRoute`（dev only） |
| 棋盘渲染 | `GameBoard` + `boardRegistry` |

## 4. 必须修改的公共模块

| 文件 | 改动 | 风险 |
| --- | --- | --- |
| `BaseGameRoom.ts` | 聊天服务接线、`options` 解析、Bot 调度钩子、sandbox 端点 | 高（5677 行单文件，必须增量、不得重构） |
| `durable-objects/types.ts` | `GameRoomConfig.options`、`SeatChannel` 增加 `bot`、`BasePlayerInfo.bot` | 中（`SeatChannel` 是公共契约） |
| `packages/game-catalog/src/index.ts` | 导出 options 契约与解析函数 | 中（Web 与 Workers 共享，需要重建 dist） |
| `packages/game-catalog/src/manifest.ts` | 不新增 `GAME_OPTIONS` 到此，改为独立 `options.ts`（保持 manifest 纯描述性） | 低 |
| `apps/workers/src/mcp/createServer.ts` | 2 个聊天工具、`room_create` 增加 `options`、instructions 更新 | 中（AI 规范快照需重新生成） |
| `apps/workers/src/api/rooms.ts` | create schema 增加 `options` | 低 |
| `apps/web/src/domain/game-state.ts` | 新增 `chat`/`options`/`bot` 相关可选字段 | 低（catchall 兜底） |
| `apps/web/src/services/gameSocket.ts` | `chat_*` 消息 + `sendChat` + `options` 透传 | 低 |
| `apps/web/src/interface/Room.tsx` | 挂载 RoomChat、创建时传 options | 中（页面主流程） |
| `apps/web/src/i18n/locales/{en,zh-CN}.ts` | 新增词条（zh-CN 与 en 类型强制同步） | 低但必须成对 |

## 5. 向后兼容风险

| 风险 | 处理 |
| --- | --- |
| 旧房间缺 `options` | 插件用历史默认值；不写回旧状态、不重算历史结果 |
| `SeatChannel` 增加 `bot` | `channelLabel()` 需补分支；前端 `channel` 为 `z.string()`，不会拒帧 |
| MCP 工具数量增加 | `check:ai-spec` 会比对工具数，必须重新生成 `public/ai-spec.json` |
| `room_create` 新参数 | 全部 optional，旧调用不受影响 |
| 聊天表新增 | 独立 SQLite 表 + 独立 storage key，不动 `gameState`；房间清理 `deleteAll()` 自动覆盖 |
| Bot 席位写入 `players[]` | 旧客户端把未知 `channel` 当人类渲染，不崩溃；回放身份投影需补 `bot` 标记 |
| chat 广播 | 不进入 `state` 帧，不改变行动序号、回合、时钟 |

## 6. 功能测试方案

| 阶段 | 测试文件 | 覆盖 |
| --- | --- | --- |
| C1 | `tests/platform/RoomChat*.test.ts` | WS↔WS、WS↔MCP、MCP↔MCP、独立 Controller、@提及、旁观发言策略、序号单调、游标补取、幂等、限流、长度、XSS 文本、存储失败、终局后可读、隐私（不得出现手牌字段） |
| C2 | `tests/contracts/gameOptions.test.ts`、`tests/plugins/*.test.ts` | 默认值、合法/非法选项、Web 与 MCP 一致性、旧房间回退、持久化、重启恢复、回放、规则确实生效 |
| C3 | `tests/platform/Sandbox*.test.ts` | 生产拒绝、非 sandbox 房间拒绝、真实插件行动、席位视角隔离、非法行动、终局、clientView 契约 |
| C4 | `tests/bot/*.test.ts` | 合法行动、无模型调用、完整对局、席位身份、失败降级、重复请求、恢复、私有状态隔离、多人、步数上限 |

回归：`pnpm lint`、`pnpm --filter @llmgames/workers test`、`pnpm --filter @llmgames/web test`、`pnpm build:all`、`pnpm check:ai-spec`。

## 7. 开发优先级

1. **C1 聊天** —— 依赖最少、纯增量，且是 C4 之后"人机同房"体验的基础。
2. **C2 选项** —— 触及创建链路，改动面广但机械；放在聊天之后可以顺带复用 `parseRoomCreationConfig` 的改造经验。
3. **C3 Sandbox** —— 依赖 C2（要选规则选项），并且需要 `clientViewSchema` 全链路。
4. **C4 Rule Bot** —— 依赖 C3 的调试能力来验证对局推进；调度是四者中最容易伤到 DO 生命周期的部分，放最后。

## 8. 明确不做

独立 Agent Runner、新模型接入、Jev 适配、AI 人格聊天、账户系统、第二套引擎/房间系统、独立 ChatRoom Worker、PostgreSQL/Redis/Kafka、插件市场、私信/群组/跨房社交、自动部署。
