# M3 设计：轻量游戏插件契约

- **依据**：[M3-AUDIT.md](M3-AUDIT.md)（基线 `7ba5c8b` 的实际代码）
- **原则**：最小可行架构、显式接口、静态注册、编译期校验、少量可理解的抽象
- **不引入**：动态插件加载、插件市场、DSL、DI 容器、Event Sourcing、新常驻后端、新数据库

## 1. 三层边界

```text
apps/web/src/game-ui/boardRegistry.ts       ← 展示层注册表（id → lazy 组件）
apps/web/src/interface/catalog.ts           ← 读 manifest，不再自己写元数据

apps/workers/src/games/contract.ts          ← 规则契约（纯类型 + 副作用描述）
apps/workers/src/games/<game>/plugin.ts     ← 规则模块（状态、校验、结算、投影）
apps/workers/src/games/<game>/rules.ts      ← 可选：纯函数（棋盘/发牌等）
apps/workers/src/durable-objects/<X>Room.ts ← 薄适配器（~40 行平台胶水）
apps/workers/src/durable-objects/BaseGameRoom.ts ← 平台运行时（不新增游戏分支）

packages/game-catalog/src/manifest.ts       ← 每游戏元数据（唯一一份）
packages/game-catalog/src/index.ts          ← ID 联合、生命周期、动作目录、指令
```

依赖方向是单向的：

```text
Room (适配器) ──→ GamePlugin ──→ contract.ts ──→ durable-objects/types.ts
       │                │
       └──→ BaseGameRoom（平台能力：时钟/存储/广播/回放/归档）
BaseGameRoom ──→ contract.ts + registry（只为"按 type 找规则"这一件事）
game-catalog  ──✗ 不依赖 React / Hono / Cloudflare Env / DO 实例
```

`packages/game-catalog` 保持可被 Worker、Web、MCP server、CLI 共同引用；规则契约放在 `apps/workers`，因为它需要 DO 侧的状态类型（`BaseGameState`）。

## 2. GamePlugin 契约

```ts
export interface GamePlugin<TState extends BaseGameState, TId extends string = GameTypeId> {
  readonly id: TId;
  readonly minPlayersToStart: number;
  readonly initialTurnPhase: string;

  createInitialState(config: GameRoomConfig, roomCode: string, now: number): TState;
  start(state: TState, context: GameStartContext): void;
  turnActions(state: TState, playerId: string, viewer: GameViewerContext): readonly string[];
  /** M3.3: widen "whose turn" for simultaneous or role-scoped decisions. */
  mayActNow?(state: TState, playerId: string): boolean;
  /** M3.5: extra fields merged into the browser `you` block (Battleship's wallet). */
  youFields?(state: TState, playerId: string, viewer: GameViewerContext): WireObject;
  seatIdentity(state: TState, playerId: string, viewer: GameViewerContext): GameSeatIdentity;
  applyAction(state: TState, playerId: string, intent: GameIntent, now: number): GameActionResult;

  onTurnTimeout?(state: TState, playerId: string | null, now: number): readonly GameEffect[];
  /** M3.3: match-clock result (Reversi scores the board instead of drawing). */
  onMatchTimeout?(state: TState): void;
  /** Declared once, enforced on every outgoing view (see §7.2). */
  projectState?(state: TState, playerId: string): object;
  /** M3.4: replay frames; default is the whole state (full reveal). */
  rewatchView?(state: TState): object;
  /** M3.2.1: receives the recipient's own projection, never the raw state. */
  agentFields?(projection: WireObject): WireObject;
}
```

实现文件：`apps/workers/src/games/contract.ts`。

### 2.1 为什么是"返回效果"而不是"调用平台方法"

`applyAction` 不能直接 `saveState()` 或 `broadcast()`：M2 的幂等要求"状态生效"与"回执落盘"在同一次写入里完成，而这个写入点在 `BaseGameRoom.dispatchAction` 内。如果规则模块自己落盘，就会重新打开 M2.4 修补过的裂缝。

因此规则只描述**发生了什么**：

```ts
export type GameEffect =
  | { type: "event"; event: string; data?: WireValue }   // 审计/回放事件
  | { type: "stop_timers" }                              // 对局结束，停表
  | { type: "match_ended"; reason: string };              // 持久化后广播 game_ended
```

平台侧 `BaseGameRoom.applyGameEffects(effects)` 是**唯一**执行点（`:3343`）。规则的副作用因此是可枚举、可断言、可比较的（Connect4 的弃牌、结束、换手在测试里逐条断言）。

### 2.2 每个钩子对应旧实现的哪一处

| 钩子 | 旧实现 | 迁入理由 |
| --- | --- | --- |
| `createInitialState` | `createDefaultState` | 与房间无耦合，纯数据 |
| `start` | `onStartGame` | 需要平台给的首发索引（CSPRNG / 系列赛协调者） |
| `turnActions` | `getLegalActions` 的 `super` 之后 | 大厅/房主动作仍由平台给，插件只给回合动作 |
| `seatIdentity` | `buildYouContext` 的 `super` 之后 | 只描述座位语义，不复制身份/渠道元数据 |
| `applyAction` | `handleGameAction` + 私有 `handleDrop` 等 | 校验、拒绝文案、状态转移、结算 |
| `onTurnTimeout` | `onTurnTimeout`（可选，默认 `nextTurn()`） | 只有自定义策略的游戏实现（Reversi 跳过、Battleship 布阵超时、Poker 弃牌） |
| `projectState` | `projectStateFor`（可选；声明后**自动**接管浏览器、WebSocket 广播与 Agent 三条出口，未声明则整份 state 公开） | fog of war 属于规则（Poker/Codenames/Contexto/Pokemon/Battleship 的真实使用场景） |
| `agentFields` | `buildAgentView` 的 `switch (projected.type)` | 决定态字段是游戏知识，不该写在平台类里；入参是**收件人投影**，平台键被丢弃 |
| `mayActNow` | `isYourTurn` 覆写（Battleship `:803`、Codenames `:323`） | 并发布阵/全队猜词需要"不止一个座位可行动"；平台单点消费它 |
| `onMatchTimeout` | `onGameTimeout` 覆写（Reversi/Checkers） | 对局时钟到期要按盘面结算或判和，而默认只收尾不留结果 |
| `youFields` | `buildYouContext` 覆写（Battleship 的 `ready`/`munitionPoints`/`weapons`） | 人类视图也需要游戏专属字段，与 `agentFields` 对称；Codenames 的 `team`/`canSeeKey` 可直接复用 |
| `rewatchView` | `buildRewatchView` 覆写（Checkers 剥离重复计数，Codenames 揭示 key） | 回放是全量揭示，但仍不该写入平台内部簿记 |

`agentFields` 是**唯一**带真实迁移证据的可选能力：8 款游戏中 7 款有专属决定字段，平台的 switch 因此长期存在。`projectState` 同理（5 款游戏有隐藏信息）。`onTurnTimeout` 有 4 款游戏的差异化策略。没有为"将来可能"新增其他钩子。

### 2.3 不放进契约的东西

- 时钟、alarm、席位、WebSocket、幂等、目录、归档、回放帧、Jev（平台能力）
- 展示文案与组件（Web 层；插件不依赖 React）
- 模型供应商（`GamePlugin` 不得依赖任何 provider，M4 才会有 Agent Runner）

## 3. 静态注册表与编译期校验

`apps/workers/src/games/registry.ts`：

```ts
const PRODUCTION_PLUGINS: readonly GamePlugin<BaseGameState, GameTypeId>[] = [connect4Plugin];
const pluginsById = new Map<string, GamePlugin<BaseGameState, string>>();
for (const plugin of PRODUCTION_PLUGINS) {
  if (pluginsById.has(plugin.id)) throw new Error(`Duplicate game plugin id: ${plugin.id}`);
  pluginsById.set(plugin.id, plugin);
}
```

- 数组元素类型是 `GamePlugin<BaseGameState, GameTypeId>`，因此插件 id 只能是**已知**游戏 ID（测试夹具用 `GamePlugin<TState, "minimal">` 绕过，不进生产注册表）。
- 重复 ID 在模块加载时抛错。
- `gamePluginFor(id)` 供平台按 `state.type` 查找（`BaseGameRoom.buildAgentView` 使用），`registeredGamePluginIds()` 供覆盖测试与文档使用。
- 注册表**不是路由表**：房间由显式 `gameRules()` 提供规则；注册表只解决"这个 state.type 对应哪份规则声明"。

编译期校验位置：

| 检查 | 机制 | 失败表现 |
| --- | --- | --- |
| 新游戏必须声明元数据 | `GAME_MANIFESTS satisfies Record<GameTypeId, GameManifest>` | 编译错误 |
| 新游戏必须有棋盘 | `BOARDS: Record<GameTypeId, LazyBoard>` | 编译错误 |
| 元数据不得多出未知 ID | `satisfies` 的 excess property check | 编译错误 |
| 中英文词条齐全 | `zhCN: Messages = Record<MessageKey,string>` + `gameManifest` 测试 | 编译错误 / 测试失败 |
| 规则不得静默改变玩法 | Connect4 金样本逐动作比对 | 测试失败 |

## 4. 元数据：一份声明

`packages/game-catalog/src/manifest.ts` 的 `GAME_MANIFESTS` 是游戏文案与命名的唯一来源（`id`、`title`、`players`、`category`、`detail`、`i18n.game`）。`apps/web/src/interface/catalog.ts` 不再自己写一份英文，只保留**展示顺序**（`LIBRARY_ORDER`）。

`GAME_LIFECYCLE`、`GAME_INSTRUCTIONS`、`GAME_ACTIONS` 保持原样：它们是**对外契约的一部分**（AI 规格由它们生成），本轮搬动它们只会制造无收益的 diff 和 ai-spec 抖动。

## 5. Cloudflare Durable Object：方案 A / B 的取舍

### 方案 A：保留每游戏 DO，抽出共享契约（**本轮采用**）

- 每个游戏保留自己的类与 Namespace，`Connect4Room` 类名、绑定、`new_sqlite_classes`、持久化键（`gameState`）、SQLite 历史表都不变。
- 规则迁到 `games/connect4/`，房间变成 98 行的适配器。
- 旧实例（运行中或已归档未清理）恢复路径完全不变。
- 新增游戏仍然需要：导出类、加 `Env` 绑定、`roomRouting` 加 case、两个 wrangler 配置、追加一个 DO 迁移。

### 方案 B：新增通用 Durable Object，按注册表跑插件（本轮**不实施**）

理论上可行：`export const GameRoom = createGameRoom()` 只依赖注册表；新增简单游戏可复用同一 Namespace，省掉 5 个部署文件。

但审计后判定收益不足以支撑风险：

1. **D1 成本不会消失**。`active_rooms`（`migrations/0042`）、`game_logs`（`migrations/0045`）、`broadcast_rooms` 都用 `CHECK (game_type IN …)` 枚举；SQLite 不能原地改 CHECK，每次新游戏仍需**追加**一个重建表迁移。省掉 DO 迁移，仍要 D1 迁移。
2. **部署不可在本轮验证**。新增 Namespace 需要 `wrangler deploy` 才会生成真实类；本轮禁止部署，无法证明"新 Namespace + 老 Namespace 并存"在恢复、`idFromName`、迁移序列上无副作用。
3. **恢复语义要重新证明一遍**。通用类一旦把 `type` 变成数据而不是类身份，就必须证明：历史表归属、`ackedActionRecords`、`directoryExpiryPending`、alarm 重试在"同一类服务多种游戏"下仍然成立（M2 的 P0 修补都在这几条路径上）。
4. **旧房间无法迁移**。已存 DO 实例无法换类，方案 B 只能对**新**游戏生效，等于长期维护两套运行时。

### 结论：分阶段

- 本轮完成"契约 + 适配层 + 最小夹具"，这正是方案 B 的前置条件：夹具证明了一个只声明规则的房间能跑完整生命周期。
- 若后续要上方案 B，最小路径是：新增 `GAME_ROOM` 绑定与一个 `GenericGameRoom`（复用本轮的 `gameRules()` + `applyGameEffects`），`roomRouting` 对"有插件且标记 `runtime: "generic"` 的游戏"返回该绑定，旧游戏继续走原 Namespace，**不迁移任何存量实例**；同时仍需追加一条放宽 `game_type` CHECK 的 D1 迁移。

**M3 消除的改动点**：平台分支（`buildAgentView` switch）不再需要为新游戏加 case；规则不再写进 5 500 行的平台类；元数据只写一处；前端棋盘选择不再改 `GameBoard`。
**M3 未消除的改动点**：DO 类导出/绑定/迁移、`roomRouting` case、`Env` 类型、D1 CHECK 迁移。这些是 Cloudflare 的部署事实，不是设计缺陷，报告里如实计入成本。

## 6. i18n

- 命名空间沿用现状：`game.<gameId>.*`（`title`/`category`/`detail`/`hook`/`hint`），`board.*` 是**共享扁平词表**（"row"、"column"、"captured pieces"），不是每游戏一表。审计发现 `board.<id>.*` 从未存在，因此 manifest 不假装它有。
- manifest 的 `i18n.game` 声明归属；`apps/web/tests/i18n/gameManifest.test.ts` 断言 `KNOWN_GAME_TYPES` 每款在两个 locale 里都有 5 个 key。
- 回退顺序不变：`translate()` 缺失时回英文（`i18n/core.ts:149-158`）。
- 新游戏缺中文时：`zhCN` 类型上就必须补齐（编译失败），因此生产不会出现"半英文"；若确实需要先上英文，办法是把 key 加入 `en` 后临时复用英文值，而不是改回退逻辑。
- **服务端动态文案**：保持 `message`（英文，MCP 契约）+ `code`（`RoomErrorCode`）双轨；新文案必须带 `code`，前端按 code 本地化，旧客户端继续读 message。Battleship 的 `lastAnnouncement` 属未改造项，留待该游戏迁移（见 M3-AUDIT §6）。

## 7. MCP 兼容

- 不新增顶层工具，不新增每游戏 Server。动作仍通过 `list_game_tools` / `get_tool_schema` / `send_action` 发现与提交。
- `agentFields` 只改变"字段由谁生成"，不改变字段集合：Connect4 的 MCP 状态仍是 `board`/`seats`/`lastMove`，由金样本与 `check:ai-spec` 双重把关。
- `requestId`、controller/seat 边界、OAuth 流程均未触碰。

## 7.1 M3.3 的能力验证结论

详见 [M3.3-CAPABILITY.md](M3.3-CAPABILITY.md)。一句话结论：

- Connect4 + Reversi + Checkers + Battleship 实测需要的钩子已全部就位（Reversi 逼出 `onMatchTimeout` 与座位 `color`；Checkers 逼出 `rewatchView` 与可省略的 `role`；Battleship 逼出 `youFields` 与可省略的 `seat`）；
- Battleship 已于 M3.5 迁移完成，见 §7.3；
- Codenames 还需要 `validateStart`、座位 `team`/`canSeeKey`、成员角色变更钩子，三者都只服务它一个游戏，留到迁移时再加。

## 7.2 公开投影只有一个出口（M3.4.1）

`BaseGameRoom.projectStateFor` 是浏览器视图、WebSocket 广播和 Agent 视图的共同入口；它的默认实现现在读 `this.gameRules()?.projectState`，所以插件一旦声明投影就自动生效，不需要适配房间再写一行转发。

这条教训来自 Checkers：`projectState` 被声明却没接进调用链，`positionCounts` 通过浏览器视图回到了客户端。规则等价测试看不出来，因为金样本只比对规则字段。防线因此升级为**行为级**的：`pluginProjection.test.ts` 对每款已迁移游戏计算"插件隐藏了哪些键"，并要求这些键在 browser / agent / replay 三种视图里都不出现，同时要求 `board` 仍在（否则"投影把一切删掉"也会通过）。

## 7.3 隐藏信息游戏怎么接（M3.5 Battleship）

Battleship 是第一款**私有信息 + 并发行棋**同时存在的迁移，它没有逼出新机制，而是验证了三处既有能力确实够用：

| 需求 | 用到的钩子 | 结果 |
| --- | --- | --- |
| 双方同时布阵 | `mayActNow` | ✅ 平台只在 `isYourTurn` 一处消费，`wait_for_turn` 自动跟着生效 |
| 私有舰队 / 旁观双盲 | `projectState` | ✅ 三条出口（浏览器 / 广播 / Agent）共用一次声明 |
| MCP 决定态（ASCII 网格） | `agentFields(projection)` | ✅ 直接复用 catalog 的 `battleshipAgentState`，平台分支删除 |
| 回放揭盘 | `rewatchView` | ✅ 与实时投影分离，回放才带 `revealedShips` |
| 布阵超时自动布阵 | `onTurnTimeout` | ✅ 规则只返回事件，落盘/广播交给 `settleRuleTimeout` |
| 兵种/能量显示 | `youFields` | ⚠️ 新增（本次唯一新增钩子）；`seat` 改为可选，因为 Battleship 的 `you` 从来没有 `seat` 键 |

一处**顺带修好的旧缺陷**：原 `finishAttackTurn` 在终局时执行 `void this.saveState().then(broadcast)`，正是 M3.2.1 在 Connect4 上修掉的"提前落盘"模式。迁移后它改为 `match_ended` 效果，终局状态与幂等回执重新变成同一次写入。

## 8. 迁移步骤（单游戏）

1. 建 `apps/workers/src/games/<id>/rules.ts`（纯函数）与 `plugin.ts`（契约实现），字段从原房间**原样搬运**。
2. 房间类改为适配器：实现 `gameRules()`，把 5 个钩子转发到插件；`handleGameAction` 只做 `applyAction` + `applyGameEffects`。
3. 先跑既有测试，确认行为未变。
4. 补等价性测试：迁移前抓一份金样本（动作序列 → 棋盘/座位/合法动作/拒绝文案），迁移后逐条比对。
5. 在 `registry.ts` 注册；`buildAgentView` 的旧分支删除。
6. 只有确认全部通过，才允许动下一款游戏。

## 9. 验收标准

| 编号 | 标准 | 验证方式 |
| --- | --- | --- |
| A1 | 只声明规则的房间能跑完整生命周期 | `tests/games/minimal/MinimalGameRoom.test.ts`（9 例） |
| A2 | 规则可脱离房间单测 | `tests/games/connect4/rules.test.ts`（5 例） |
| A3 | 迁移不改变玩法 | `Connect4Room.equivalence.test.ts` + `connect4.golden.ts` |
| A4 | 公开 MCP 契约不变 | `pnpm check:ai-spec` |
| A5 | 隐私投影不退化 | Minimal 隐藏字段测试 + `privateProjection.test.ts` |
| A6 | 幂等不退化 | Minimal 重复 `requestId` 测试 + `BaseGameRoom.idempotency.test.ts` |
| A7 | 前端按注册表选棋盘且仍 lazy | `boardRegistry.test.ts` + 构建资产校验 |
| A8 | i18n 不回退 | `gameManifest.test.ts`（10 例） |
