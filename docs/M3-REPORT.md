# M3 实施报告：游戏接口统一与轻量插件化

- **分支**：`main`
- **基线 Commit**：`7ba5c8b`（任务书给出的 `b869f3a` 为其前两个提交；未 reset，未覆盖任何未提交改动）
- **完成范围**：M3.0 审计、M3.1 契约 + 最小游戏夹具、M3.2 Connect4 试点迁移
- **未做**：未部署、未推送、未改生产 D1/R2 数据、未改迁移历史、未启用 CI、未迁移其余 7 款游戏

## 1. 结论

| 问题 | 回答 |
| --- | --- |
| 契约建立了吗 | 是。`GamePlugin`（6 必需 + 3 可选成员）+ `GameEffect` 三态副作用 + 静态注册表，编译期与运行期都有校验 |
| 只声明规则能跑完整对局吗 | 是。`MinimalGameRoom` 适配器 121 行、规则 198 行，9 个用例覆盖创建/加入/开局/合法与非法行动/投影/隐私/超时/终局/回放/重启恢复/幂等/旁观者 |
| Connect4 迁移保住了玩法吗 | 是。迁移前抓的金样本（7 步动作 + 10 个拒绝场景）逐字段一致，含棋盘、座位、换手、合法动作、胜负与拒绝文案 |
| 新增游戏成本真的降了吗 | 部分降低：平台分支（`buildAgentView` switch）不再需要改，元数据只写一处，前端不再改 `GameBoard`；**DO 绑定 + D1 迁移仍需改**，属 Cloudflare 部署约束 |
| MCP 公开契约变了吗 | 没有。`check:ai-spec` 通过（17 工具 / 8 游戏 / 7 Jev 适配器） |

## 2. 完成的子阶段

| 子阶段 | 交付 |
| --- | --- |
| M3.0 | `docs/M3-AUDIT.md`、`docs/M3-DESIGN.md`（接入矩阵、隐含契约、方案 A/B 取舍） |
| M3.1 | `apps/workers/src/games/{contract,registry}.ts`、`tests/fixtures/minimal-game/*`、`tests/games/minimal/MinimalGameRoom.test.ts` |
| M3.2 | `apps/workers/src/games/connect4/{rules,plugin}.ts`、`Connect4Room` 适配器化、金样本等价性测试、`rules.test.ts` |

## 3. 新增与修改的文件

**新增（14）**

```text
packages/game-catalog/src/manifest.ts                             110  GAME_MANIFESTS（元数据唯一来源）
apps/workers/src/games/contract.ts                                 92  GamePlugin / GameEffect / 上下文类型
apps/workers/src/games/registry.ts                                 39  静态注册表 + 重复 ID 检查
apps/workers/src/games/connect4/rules.ts                           72  纯函数（落子/四连/满盘）
apps/workers/src/games/connect4/plugin.ts                         166  规则实现（从 Connect4Room 原样搬运）
apps/workers/src/tests/fixtures/minimal-game/plugin.ts            198  最小游戏规则（隐藏数字 + 超时弃权）
apps/workers/src/tests/fixtures/minimal-game/room.ts              121  最小游戏适配器
apps/workers/src/tests/games/minimal/MinimalGameRoom.test.ts      378  平台级验收（9 例）
apps/workers/src/tests/games/connect4/rules.test.ts               121  规则级单测（5 例）
apps/workers/src/tests/games/connect4/connect4.golden.ts          444  迁移前金样本
apps/workers/src/tests/games/connect4/Connect4Room.equivalence.test.ts 189 逐动作等价性
apps/web/src/game-ui/boardRegistry.ts                              56  棋盘注册表（全 lazy）
apps/web/tests/game-ui/boardRegistry.test.ts                       22
apps/web/tests/i18n/gameManifest.test.ts                           56
```

**修改（6）**

```text
apps/workers/src/durable-objects/Connect4Room.ts   276 → 98 行（规则移出，保留类名/命名空间/状态格式）
apps/workers/src/durable-objects/BaseGameRoom.ts   +54 行（gameRules / applyGameEffects / 插件化 agentFields / 删除 connect4 分支）
apps/workers/src/durable-objects/types.ts          导出 BaseTurnState（夹具复用）
packages/game-catalog/src/index.ts                 导出 manifest
apps/web/src/interface/catalog.ts                  改为读 GAME_MANIFESTS，只保留展示顺序
apps/web/src/game-ui/GameBoard.tsx                 if 链 → 注册表
```

`git diff --stat`：6 个已跟踪文件 `+122 / −310`（净减 188 行平台代码，不含新增模块）。

## 4. 核心 GamePlugin 接口

```ts
interface GamePlugin<TState extends BaseGameState, TId extends string = GameTypeId> {
  readonly id: TId;
  readonly minPlayersToStart: number;
  readonly initialTurnPhase: string;

  createInitialState(config, roomCode, now): TState;
  start(state, { firstPlayerIndex, now }): void;
  turnActions(state, playerId, { isSpectator }): readonly string[];
  seatIdentity(state, playerId, { isSpectator }): { seat: number | null; role: string | null };
  applyAction(state, playerId, { actionType, data }, now): GameActionResult;

  onTurnTimeout?(state, playerId): readonly GameEffect[];   // 默认换手
  projectState?(state, playerId): object;                   // 默认整份公开
  agentFields?(state): WireObject;                          // 默认无额外 MCP 字段
}
```

`GameEffect`：`event`（审计/回放）、`stop_timers`、`match_ended`（持久化后广播 `game_ended`）。规则模块**不**落盘、不广播、不读时钟——由 `BaseGameRoom.applyGameEffects` 唯一执行（`:3343`）。

## 5. 最小游戏夹具执行结果

`apps/workers/src/tests/games/minimal/MinimalGameRoom.test.ts` —— **9/9 通过**。全部走真实平台路径（`/create`、`/agent/join`、`/agent/start`、`/agent/action`、`/agent/view`、`alarm()`），没有为夹具开特殊分支。

| 验收项 | 用例 |
| --- | --- |
| 创建 / 加入两个不同玩家 / 各自身份 | creates a room, seats two distinct players and starts through the platform |
| 开始游戏 / 合法行动列表 | 同上（只有当前玩家拿到 `stake`） |
| 执行合法行动 | applies a legal stake… |
| 拒绝非法行动（非当前玩家 / 越界 / 未知动作） | 同上（状态未被修改） |
| 当前玩家投影 + 隐藏字段 | hides every other player's hidden number…（对手数字不出现在浏览器投影，agent 视图无 `secrets`） |
| 回合超时 | passes the turn on a timeout and forfeits after three…（同一玩家 3 次超时判负） |
| 正常结束 | ends at the target score… |
| Replay 数据 | 同上（重放视图含双方隐藏数字，`status: ended`） |
| 持久化与恢复 | restores the match from storage after the Durable Object restarts |
| 重复 `requestId` | replays a repeated requestId…（第二次返回 `replayed: true`，分数不变） |
| 旁观者不能行动 | refuses an outsider and offers nothing to a spectator + 插件对 `isSpectator` 返空 |
| MCP 状态结构未破坏 | keeps the compact MCP decision state intact（`gameType/status/legalActions/turnNumber`） |

## 6. Connect4 迁移情况

- `Connect4Room` 保留对外类名、DO 命名空间、`gameState` 持久化键与字段结构；仅改为 5 个钩子转发 + `gameRules()`。
- 规则代码逐行搬到 `games/connect4/`，拒绝文案、事件名、事件字段、`stop_timers`/`game_ended` 顺序保持不变。
- **等价性证据**：迁移**前**用旧实现跑固定意图序列（`seat1:0, seat2:0, seat1:1, …` + 拒绝探针），落盘为 `connect4.golden.ts`；迁移后同一脚本必须逐字段相等 —— `Connect4Room.equivalence.test.ts` 通过。比对的字段：棋盘、`status`、`phase`、`turnNumber`、当前座位、胜负、`lastMove`、双方 `legalActions`、10 个拒绝场景的 HTTP 状态 + `code` + `message` + `category` + `recovery`。
- 既有 `Connect4Room.test.ts`（3 例）与 `otherGameContracts`、`agentDecisionState`、`ai-spec` 全部通过，说明 MCP 决定态与示例未变。

## 7. 新增游戏成本：M3 前后

| 指标 | M3 前 | M3 后 |
| --- | --- | --- |
| 需要修改的**已有**文件（简单双人游戏） | ≈ 24（30 个命中文件减去规则/组件/测试） | ≈ 12 |
| 需新增文件 | 2（房间 + 棋盘） | 3–4（规则 + 适配器 + 棋盘 + 可选 rules） |
| 平台类新增分支 | `buildAgentView` 的 `switch` 加 1 个 case + `getLegalActions`/`buildYouContext` 覆写 | **0**（`agentFields` 由插件提供） |
| `switch(gameType)` / `if (gameType===)` 需加分支持 | 4 处（`roomRouting`、`buildAgentView`、`agent-state`、`jev`） | 3 处（`buildAgentView` 已消除；`agent-state`/`jev` 仍按需） |
| 元数据声明 | 3 个文件（web catalog + 2 个 locale 的英文兜底） | 1 处（`GAME_MANIFESTS`；locale 仍要译） |
| 前端选择棋盘 | 改 `GameBoard.tsx` | 改 `boardRegistry.ts` 一行（每游戏仍强制登记，编译期） |
| 仍需新 DO Namespace + 迁移 | 是 | **是**（未消除，见 §9） |
| 仍需追加 D1 CHECK 迁移 | 是 | **是**（`active_rooms`/`game_logs`/`broadcast_rooms`） |
| 仍需改 MCP Server | 否（动作目录驱动） | 否 |

"明天接入《谁是卧底》要写什么"现在的答案：

1. `packages/game-catalog/src/index.ts`：`GameTypeId` 加一行；`GAME_ACTIONS` 加动作；`GAME_INSTRUCTIONS` 加简报。
2. `packages/game-catalog/src/manifest.ts`：加一段 manifest（标题/人数/分类/简介/`game.<id>`）。
3. `apps/workers/src/games/undercover/{rules,plugin}.ts`：规则实现（不落盘、不广播）。
4. `apps/workers/src/durable-objects/UndercoverRoom.ts`：约 40 行适配器。
5. 部署面（**平台无法自动提供**）：`index.ts` 导出、`types.ts` 的 `Env`、`roomRouting.ts` 一个 case、两个 wrangler 配置、`migrations/` 追加一条放宽 `active_rooms.game_type` 的迁移。
6. 前端：`boardRegistry.ts` 一行、一个 lazy 棋盘组件、两个 locale 各 5 个 key、`catalog.ts` 顺序一行。
7. 测试：规则单测 + 房间集成测试，并在 `tests/fixtures/game-spec.ts` 加一份 ai-spec 示例。

平台自动提供：席位/房主/旁观者、WebSocket、时钟与 alarm、幂等回执、持久化与恢复、目录与寿命、归档与回放、MCP 工具与动作发现、中英文框架、隐私投影骨架。

## 8. MCP 接口兼容性

- 工具集合未变：`agent_claim`、`room_create/join/connect`、`list_game_tools`、`get_tool_schema`、`get_state`、`wait_for_turn`、`send_action`、`start_game` 等 17 个。
- 未添加每游戏工具、未改 OAuth、未改 `requestId` 语义、未改 controller/seat 边界。
- `pnpm check:ai-spec`：**通过**（"AI spec matches all 17 MCP tools, 8 game catalogs and 7 hosted Jev adapters"），`ai-spec.json` **零 diff**。
- 唯一的行为迁移：Connect4 的 MCP 决定字段由插件生成，字段集合与顺序不变（等价性测试 + ai-spec 双重验证）。

## 9. Durable Object 与存储兼容性

- 未新增/删除 DO 类，未改 `new_sqlite_classes`，未改任何迁移文件。
- `gameState` 结构未变（插件 `createInitialState` 与原实现字段、默认值、`expiresAt` 计算一致）。
- 旧房间恢复路径未改：`restorePersistedRoom`、`ackedActionRecords`、`directoryExpiryPending`、alarm 重试、归档 outbox 全部保持原实现。
- **未消除**的部署成本已在 M3-DESIGN §5 说明：新增游戏仍要自己的 Namespace 与追加式迁移；方案 B（通用 DO）本轮不实施，理由（D1 迁移不消失、无法在本轮验证部署、旧实例不可迁移）写在设计文档里。

## 10. 隐私投影测试结果

| 场景 | 结果 |
| --- | --- |
| Minimal：对手隐藏数字 | 浏览器投影只含自己的 `secrets[playerId]`；agent 视图无 `secrets` 键 |
| Minimal：旁观者 | 插件对 `isSpectator` 返回空动作与 `{seat:null, role:"spectator"}`；非成员行动 403 |
| Connect4：无隐藏信息 | 双方投影一致（金样本逐步比对） |
| 其余 7 款 | `privateProjection.test.ts`（Codenames key / Contexto secret）、`PokerRoom.projection.test.ts`、`agentProjection.test.ts`（Battleship 水雷、Pokemon 手牌）全部通过，未受影响 |

## 11. 实际校验结果

| 命令 | 结果 |
| --- | --- |
| `pnpm lint` | ✅ anti-slop 0 error（410 文件）、各包 eslint/tsc、strict production type check、AI 规格校验全部通过 |
| `pnpm test` | ✅ workers **74 文件 / 619 用例**（基线 71 / 604，+3 文件 +15 用例）；web **13 文件 / 349 用例**（基线 11 / 336，+2 文件 +13 用例）；mcp-server、game-catalog、cli 通过 |
| `pnpm build:all` | ✅ 6/6 任务；web 30 页构建，47 个 JS/CSS 资产校验通过 |
| `pnpm check:ai-spec` | ✅ 17 工具 / 8 游戏目录 / 7 Jev 适配器，`ai-spec.json` 无 diff |

未执行：`wrangler deploy --dry-run`（本轮未改 wrangler 与绑定，无新增配置需要验证）、Playwright e2e（需要本地 dev server 与浏览器，未在约束内启动）。

## 12. 尚未解决的风险

1. **`compactAgentDecisionState` 仍是 `if (gameType === …)` 链**（`packages/game-catalog/src/agent-state.ts:384-514`）。新插件的紧凑决定态只会落到 `common`（`gameType/status/legalActions/turn`），没有棋盘字段。Connect4 不受影响（分支仍在，等价性已验证），但新游戏想有紧凑决定态必须改这个共享文件 —— 这是 M3 之后最值得收口的一处。
2. **7 款游戏仍是 legacy**：`BaseGameRoom.buildAgentView` 里还留着 7 个 `case`，`onTurnTimeout`/`projectStateFor` 仍是子类覆写。逐款迁移是安全的，但每款都要重复 §6 的等价性流程。
3. **Battleship 的 `agentDecisionReadyAt` 与 5 分钟并发布阵**：契约里没有对应钩子（`onTurnTimeout` 不能表达"布阵超时→自动部署→继续"）。迁移 Battleship 时需要新增一个**有真实用途**的可选钩子，届时必须给出等价性证据。
4. **Codenames 的 `assignRoles` 开局前时序**同样依赖大厅动作（`assign_codenames_role`），属平台级动作而非规则钩子；迁移时要把"谁可以改角色"留在平台。
5. **`lastAnnouncement` 仍是无 code 的英文散文**（Battleship）。已固化为 `code+params+legacy message` 的迁移约定，但未实施。
6. **注册表目前不是路由表**：`gamePluginFor()` 只用于按 `state.type` 找 `agentFields`，不决定 Namespace。方案 B 未验证，成本见 §9。
7. **金样本依赖 CSPRNG 打桩**（`vi.spyOn(crypto, "getRandomValues")`）。它只影响测试，不影响生产；若未来首发改为系列赛协调，这条测试需同步改为 `series.firstPlayerId`。

## 13. 下一阶段建议

1. **迁移 Reversi**（低风险，验证"自动跳过 + 按子数终局"能否用现有钩子表达）。
2. **迁移 Battleship**（验证 `projectState` + 新增 `decisionReadyAt` 类钩子的必要性；这是契约最可能被推翻的一次）。
3. **把紧凑决定态收进插件**：在 `game-catalog` 定义 `GameDecisionFields`，worker 侧插件实现；或让 `agentFields` 同时产出紧凑形态。需先确认 ai-spec 输出形态可稳定生成。
4. **评估方案 B**：`GenericGameRoom` + `GAME_ROOM` 绑定，只对新游戏生效；前置条件是本轮的夹具已证明"只声明规则即可运行"。
5. **i18n 增量**：给 `lastAnnouncement` 一类字段补 `code`，前端按 code 渲染，旧 MCP 客户端继续读英文。

## 14. 本地提交

本轮改动已提交到本地 `main`（未推送、未部署）：

- **实现提交**：`ced26c5` — "Unify game rules behind a static plugin contract"
- **基线**：`7ba5c8b`
