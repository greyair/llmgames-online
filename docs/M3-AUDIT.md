# M3.0 审计：游戏接入现状

- **分支**：`main`
- **审计基线**：`7ba5c8b`（"Add the live homepage screenshot"，2026-10-30）。任务书给出的 `b869f3a` 是它的前两个提交，本轮以实际 HEAD 为准，未 reset。
- **审计范围**：`packages/game-catalog`、`apps/workers/src`（durable-objects / lib / api / agents / mcp）、`apps/web/src`（interface / game-ui / i18n）、`apps/workers/migrations`、`apps/workers/wrangler*.json`
- **审计方式**：阅读源码 + 类型引用 + 现有测试，不依据 README 推断

## 1. 结构现状

三层已经存在，但边界只在运行时清晰，在代码组织上并不清晰：

| 层 | 位置 | 现状 |
| --- | --- | --- |
| 平台运行时 | `apps/workers/src/durable-objects/BaseGameRoom.ts`（5 546 行） | DO 生命周期、席位、WebSocket、时钟/alarm、持久化、幂等回执、目录、归档、回放、Jev。同时**内嵌了按 `state.type` 分支的游戏逻辑** |
| 游戏规则 | `apps/workers/src/durable-objects/*Room.ts` | 规则与平台钩子混在一个 DO 类里：`Connect4Room` 276 行，`BattleshipRoom` 1 611 行，`PokerRoom` 1 227 行 |
| 共享契约 | `packages/game-catalog/src/*` | 游戏 ID 联合、生命周期、动作目录、指令文案、agent 投影、系列赛契约、归档文档 |
| 前端展示 | `apps/web/src/game-ui/*`、`interface/*`、`i18n/*` | 每游戏 React 组件；`GameBoard.tsx` 用 if 链选择棋盘；目录与规则文案分散在 4 个文件 |

`GameTypeId` 是**唯一**的编译期锚点：`GAME_LIFECYCLE`、`GAME_AVAILABILITY`、`GAME_INSTRUCTIONS` 都是 `Record<GameTypeId, …>`，因此新增 ID 会立刻在类型层面暴露缺口。真正的成本不在这些 Record，而在**没有类型约束的分支和配置文件**（见 §3）。

## 2. 新增游戏接入矩阵

以 `Connect4Room`（双人、无隐藏信息）、`ReversiRoom`（自动跳过）、`PokerRoom`（私有手牌/多轮下注）、`BattleshipRoom`（私有舰队/多阶段）、`CodenamesGameRoom`（队伍/队长私有 key）为样本。

| 接入项目 | 现有位置 | 是否每游戏重复 | 是否应进入 GamePlugin |
| --- | --- | --- | --- |
| 游戏 ID | `packages/game-catalog/src/index.ts:23-31`（`GameTypeId`）、`:748-757`（`KNOWN_GAME_TYPES`）、`:759-768`（`GAME_AVAILABILITY`） | 是，1 个 ID 至少 3 处 | 是（ID 只能声明一次；manifest 提供元数据） |
| 游戏元数据 | `apps/web/src/interface/catalog.ts`（标题/人数/分类/简介）+ `i18n/locales/{en,zh-CN}.ts`（5 个 key） | 是，3 个文件 | 是（服务端无需展示，但同一份数据不该写两遍） |
| 动作 Schema | `packages/game-catalog/src/index.ts:202-746`（`GAME_ACTIONS`，含 `games: GameTypeId[]`、别名、字段范围） | 是，每动作 1 段 | 是（声明式；平台据此提供 MCP 发现，不新增顶层工具） |
| 初始状态 | `<X>Room.createDefaultState()` | 是 | 是 |
| 游戏开始 | `<X>Room.onStartGame()`（随机/系列赛首发、发牌、分配角色） | 是 | 是 |
| 行动处理 | `<X>Room.handleGameAction()` | 是 | 是 |
| 合法行动 | `<X>Room.getLegalActions()`（`super` + 追加本游戏动作） | 是 | 是（只返回本游戏的**回合动作**，大厅动作用平台默认） |
| 状态投影 | `<X>Room.projectStateFor()`（Battleship/Poker/Codenames/Contexto/Pokemon 覆盖） | 是 | 是（fog of war 属于规则） |
| Agent 紧凑状态 | `packages/game-catalog/src/agent-state.ts:360-517`（`compactAgentDecisionState` 的 `if (gameType === …)` 链）+ `BaseGameRoom.buildAgentView()` 的 `switch (projected.type)`（`:3427-3523`） | 是，**两处** | 部分：决定态字段可声明；动作目录已在 catalog |
| 回合超时 | `<X>Room.onTurnTimeout()`（Reversi/Poker/Battleship/Codenames 覆盖；默认 `nextTurn()`） | 是 | 是（可选钩子，只有确有自定义策略的游戏实现） |
| 对局结束 | 各房间自己写 `recordEvent("game_ended")` + `stopTimers()` + `saveState()` + `broadcastProjected()` | 是，四处重复同一序列 | 是（改为返回 `match_ended` 效果，由平台统一执行） |
| Replay | `buildRewatchView()` / `finalizeRewatchView()`（fogged 游戏覆盖）；平台负责帧、上限、payload | 部分 | 否（回放基础设施属平台；只有"全量揭示"是本游戏的） |
| 语言资源 | `i18n/locales/en.ts`、`zh-CN.ts`（`zh-CN` 以 `Messages` 类型约束，缺词即编译失败）；`i18n/core.ts:169` 的 `gameMessage()` | 是，2 个文件、每游戏 5 个 key | 部分：命名空间由 manifest 声明，词条仍在 locales（不新增 i18n 框架） |
| 前端棋盘 | `apps/web/src/game-ui/*.tsx` + `GameBoard.tsx:63-76` 的 if 链 | 是（选择点 1 处 + 组件本身） | 是（展示层注册表，保持 lazy） |
| 前端附属分支 | `GameMark.tsx`、`GameScene.tsx`、`Landing.tsx`、`SketchArcade/Scene`、`FinalState.tsx`、`MatchDesk.tsx`、`siteMetadata.ts`、`astro/pages/llms.txt.ts` | 是（按需） | 否（属于站点装置，与规则无关；本轮不动） |
| Worker Namespace | `apps/workers/src/index.ts` 导出、`types.ts` 的 `Env`、`lib/roomRouting.ts:19-38` 的 `switch`、`wrangler.json`、`wrangler-prod.example.json`（各 2 处：binding + `new_sqlite_classes`） | 是，5 个文件 | 否（**Cloudflare 部署约束**，见 M3-DESIGN §5） |
| D1 类型约束 | `migrations/0017`→`0042` 反复重建 `active_rooms` 以扩 `CHECK (game_type IN …)`；`0045` 重建 `game_logs`；`broadcast_rooms` 同源 | 是，每次新游戏追加一个迁移 | 否（迁移只能追加，不能改写历史） |
| 系列赛 | `packages/game-catalog/src/series.ts:2-10`（`SERIES_GAMES`） | 是（仅当支持系列赛） | 部分：可声明能力，不强制 |
| Jev 托管 | `apps/workers/src/agents/jev.ts:16-24`（`JEV_GAMES`）、`:180-190`（`viewSchema` 的 enum）、提示词分支 | 是（仅当支持 Jev） | 否（M4/托管能力，插件不得依赖模型供应商） |

### 2.1 新增一款"简单游戏"实际要改哪些文件

以 Checkers 这类双人回合制游戏为例，`grep -l 'checkers'` 在 `apps/` `packages/` 内（排除测试、e2e、locales、dev 预览）命中 **30 个文件**；其中**与游戏规则无关、只因平台"认识"这个游戏而必须改**的有：

| 类别 | 文件 | 数量 |
| --- | --- | --- |
| 类型/契约注册 | `game-catalog/src/index.ts`（ID、KNOWN、可用性、生命周期、指令、动作） | 1（6 处） |
| 平台分支 | `BaseGameRoom.ts`（agent 视图 switch、JEV 判断）、`agent-state.ts`（决定态 switch）、`broadcastProjection.ts`（棋盘形状）、`jev.ts`（3 处） | 4 |
| DO 部署 | `index.ts` 导出、`types.ts` Env、`roomRouting.ts`、2 个 wrangler 配置 | 5 |
| D1 | 新迁移（`active_rooms` CHECK 重建） | 1 |
| 前端注册 | `catalog.ts`、`gameRules.ts`、`gameRules.zh-CN.ts`、`GameBoard.tsx`、`GameMark.tsx`、`GameScene.tsx`、`Landing.tsx`、`SketchArcade.tsx`、`SketchScene.tsx`、`FinalState.tsx`、`MatchDesk.tsx`、`locales/en.ts`、`locales/zh-CN.ts` | 13 |

**结论（M3 的起点指标）**：

- **纯游戏自身逻辑**：房间类（规则、校验、投影）、棋盘组件、规则文案、动作 Schema —— 约 4 个文件。
- **纯重复注册**：其余约 24 个文件，其中 10 个（平台分支 + DO 部署 + D1）是"平台为了认识这个游戏"必须改的。
- 因此当时**无法回答**"新增《谁是卧底》要改什么"，因为答案随游戏形状变化，且没有任何测试能证明"少注册一处"会失败。

## 3. 隐含契约（BaseGameRoom 的实际接入面）

审计时读出的、文档未完整列出的钩子（行号为审计时基线）：

| 钩子 | 位置 | 保护级别 | 副作用 / 隐含要求 |
| --- | --- | --- | --- |
| `createDefaultState` | `:2261` | abstract protected | 必须写入 `type`、`players`、`timerConfig`、`turnState`、`expiresAt`；`updatedAt/createdAt` 用于寿命策略 |
| `handleGameAction` | `:3312` | abstract protected | 返回字符串即拒绝（英文原文直接进 MCP）；返回 void 后平台才落盘、广播、记 `action` 事件 |
| `projectStateFor` | `:3321` | protected | 必须返回可被 `agentProjectionSourceSchema.parse` 接受的形状，否则**整条投影失败** |
| `buildYouContext` | `:3623` | protected | 子类先 `super` 再合并 `seat`/`role`；spectator 分支必须显式返回 `{seat:null, role:"spectator"}` |
| `getLegalActions` | `:3675` | protected | 子类先 `super`（含大厅/房主动作）再追加回合动作；spectator 必须为空 |
| `onStartGame` | `:3715` | protected | 平台已写入 `status=playing`、`turnNumber=1`、`phase=initialTurnPhase`、`startedAt`，子类只改游戏字段 |
| `initialTurnPhase` / `minPlayersToStart` | `:3735` / `:3725` | getter | 纯声明 |
| `onTurnTimeout` | `:3871` | protected | 默认 `nextTurn()`；若子类自行重置 `turnTimeRemaining`，`settleExpiredTimers` 的兜底重置不会触发，需自己 `saveState()` |
| `onGameTimeout` | `:3868` 附近 | protected | 平台在调用后强制 `ended/phase=ended/currentPlayerId=null` |
| `agentDecisionReadyAt` | `:5093` | protected | 只有 Battleship 覆盖（并发布阵）；决定态 `isYourTurn` 与 `legalActions` 都受它影响 |
| `buildRewatchView` | `:1982` | protected | 默认整份 state；fogged 游戏必须返回"可全量揭示"的视图 |
| `startingPlayerIndex` | `:5560` | protected | CSPRNG，系列赛用协调者指定；子类不得自行随机首发 |

关键隐含约定：**动作被接受后，平台统一做** `updatedAt`、回执、单次写入（状态 + 回执原子）、`broadcastState`、`action` 事件、唤醒 `wait_for_turn`。任何绕过 `handleGameAction` 返回值的实现都会破坏 M2 的幂等语义。

## 4. 特殊游戏需求（新接口不能明显妨碍的 8 款）

| 游戏 | 必须保留的行为 | 现有实现位置 |
| --- | --- | --- |
| Reversi | 无合法手自动跳过、双方都无手时按子数终局 | `ReversiRoom.advanceAfterMove/onTurnTimeout` |
| Checkers | 连跳、强制吃子、升王结束回合、80 手/三次重复和棋 | `CheckersRoom`（未迁移） |
| Battleship | 私有舰队、5 分钟并发布阵、`agentDecisionReadyAt`、特殊武器能量、命中后继续回合 | `BattleshipRoom`（1 611 行）+ `packages/game-catalog/src/battleship-state.ts` |
| Codenames | 开局前 `assign_codenames_role` 时序、队长私有 key、旁观者转席位 | `CodenamesGameRoom.setPlayerSeats` 前的 `assignRoles` 流程 |
| Poker | 2–6 席、下注轮次、私有底牌、边池、5 秒结果展示后才允许 `next_hand` | `PokerRoom`（1 227 行） |
| Contexto | 私有猜词历史、隐藏答案、并发猜词、排名结算 | `ContextoRoom` + `lib/contextoRanks.ts` |
| Pokémon | 同时提交、结算顺序、强制换人、引擎快照持久化 | `PokemonRoom` + `apps/workers/src/games/pokemon/engine.ts`（**已存在规则模块先例**） |
| Connect4 | 6×7、落子、随机首发、横竖斜四连、满盘平局 | 本轮迁移对象 |

`apps/workers/src/games/pokemon/engine.ts` 是仓库里第一个"规则从房间类里拆出来"的模块，但它只服务一个游戏、没有统一契约——M3.1 把它变成通用契约。

## 5. 回归风险清单

| 风险 | 触发点 | 本轮处置 |
| --- | --- | --- |
| 幂等回执与状态必须同一次写入 | 若插件自行 `saveState`，会拆开 M2.4 的原子写 | 插件不落盘；只返回效果，由 `applyGameEffects` 执行 |
| `expiresAt/playStartedAt` 影响 M2.1 房间寿命 | 若初始状态漏字段，长局会被提前清理 | 插件 `createInitialState` 保留原字段与取值 |
| `agentProjectionSourceSchema` 白名单 | 若投影多出未登记字段，`parse` 仍通过（catchall），但 compact 视图会丢数据 | Connect4 走 `agentFields`，输出字段与迁移前逐一比对（金样本测试） |
| MCP `requestId` 语义 | 平台层，插件不感知 | 未改动 |
| 归档文档契约 | `game-log-document.ts` 为唯一契约 | 未改动 |
| 前端首屏 bundle | 棋盘必须继续 lazy | `boardRegistry` 全部 `lazy()`，构建产物校验 47 个资源 |
| 服务端英文散文（`lastAnnouncement` 等） | 若改成中文会破坏 MCP 客户端 | 本轮只审计，见 §6 |

## 6. 服务端动态文案审计（i18n 增量约定）

| 字段 | 产生位置 | 是否属于对外契约 | 现状 |
| --- | --- | --- | --- |
| 动作拒绝 `error.message` | 各房间 + `actionErrors.ts` | 是（MCP 客户端直接展示） | 已是 `message`（英文）+ `code`（可本地化，`RoomErrorCode`）双轨，`apps/workers/src/tests/platform/actionErrors.test.ts` 覆盖 |
| `lastAnnouncement` | `BattleshipRoom` | 是（Battleship MCP 状态含该字段） | 仍为英文散文，**无 code**；改造会扩大 Connect4 试点范围 |
| `game_ended.reason` | 各房间 | 是（回放/归档 `end_reason` 聚合） | 机器值（`connect4`/`draw`/`time_up`…），不翻译 |
| `turn_timeout.reason` | 平台 | 是 | 机器值 `forfeit` |

**约定（写入 M3-DESIGN §6）**：新增/改造文案一律 `code` + `params` + 保留旧 `message`；前端按 `code` 本地化，旧 MCP 客户端继续读英文。本轮不改 Battleship 的 `lastAnnouncement`，因为它需要同时改投影、归档与前端，属于该游戏迁移时的任务。

## 7. 代码证据索引

```text
packages/game-catalog/src/index.ts:23-31         GameTypeId 联合
packages/game-catalog/src/index.ts:62-89         GAME_LIFECYCLE + gameLifecycle()
packages/game-catalog/src/index.ts:124-198       GAME_INSTRUCTIONS
packages/game-catalog/src/index.ts:202-746       GAME_ACTIONS
packages/game-catalog/src/index.ts:748-772       KNOWN_GAME_TYPES / GAME_AVAILABILITY / ENABLED
packages/game-catalog/src/agent-state.ts:360-517 compactAgentDecisionState 的按游戏分支
packages/game-catalog/src/series.ts:2-10         SERIES_GAMES
apps/workers/src/durable-objects/BaseGameRoom.ts 平台运行时 + 5 546 行内嵌分支
apps/workers/src/lib/roomRouting.ts:19-38        switch (gameType) → Namespace
apps/workers/src/types.ts:10-19                  Env 的 8 个游戏 Namespace
apps/workers/wrangler.json:33-34,71              binding + new_sqlite_classes
apps/workers/migrations/0042_checkers_active_rooms.sql  CHECK 重建范式
apps/workers/src/agents/jev.ts:16-24,180-190     JEV_GAMES + viewSchema enum
apps/web/src/game-ui/GameBoard.tsx:63-76         if 链选棋盘（本轮改为注册表）
apps/web/src/i18n/core.ts:163-174                gameMessage() 既有命名空间助手
```
