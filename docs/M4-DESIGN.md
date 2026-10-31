# M4 设计：把 West Window 规则装进 llmgames 的插件契约

前提：M3 的 `GamePlugin` 不动骨架。M4 只在**确实有第二个游戏需要**时才扩展公共接口，并且扩展必须向后兼容（旧房间、旧归档、旧 MCP 客户端都能继续工作）。

## 1. 规则适配的固定套路

每个游戏一个目录：

```text
apps/workers/src/games/<id>/rules.ts     纯函数：几何、合法性、胜负、计分
apps/workers/src/games/<id>/plugin.ts    GamePlugin：状态、行动、投影、效果
apps/workers/src/games/<id>/agent.ts     紧凑决策态（只从这里出 MCP 字段）
apps/workers/src/durable-objects/<X>Room.ts   ~100 行平台胶水
```

`rules.ts` 不许 import 平台类型以外的运行时（不碰 storage、socket、`Date.now()`）。插件返回 `GameEffect[]`，由平台统一落盘、记账、停表、投递终局。

映射规则：

| 来源语义 | 落地方式 |
| --- | --- |
| `create(ctx)` | `createInitialState()` 造大厅态；`start()` 洗牌/发牌/摆子并写 `turnState` |
| `apply(state, seat, move)` | `applyAction(state, playerId, {actionType, data}, now)`；拒绝时返回英文短句，且**不改状态** |
| 一回合多动作 | 插件自己决定何时换 `currentPlayerId`；平台不强制 |
| 并行决策 | `mayActNow()` 放宽"只有 currentPlayerId 能动" |
| `waitingOn` 为空 | 必须返回终局效果（`match_ended`），不能靠前端判断 |
| `outcome` | `state.winner` + `{type:"event",event:"game_ended"}` + `{type:"match_ended"}` |
| `view` | `projectState()`；观战者收到 `playerId=""`，重放走 `rewatchView()` |
| `describe` | `agentFields()`（富）+ `agentDecision()`（紧凑），两者同文件 |
| `bot` | 不移植到平台；需要时作为独立 Agent Runner 的规则策略 |

## 2. 行动契约

- 一律结构化：`place_stone {row,col}`、`move_piece {from,to,promotion}`、`play_cards {cards[]}`、`bid {score}`、`roll_dice {}`。
- 坐标零基、行从上、列从左（与 `board[row][col]` 同轴）。来源里的 GTP/ICCS 记谱只用于**展示**与 agent 阅读，解析留在插件内部。
- 每个动作在 `GAME_ACTIONS` 注册 `data` 字段（type/required/minimum/maximum），MCP 通过 `list_game_tools` 自动发现；**不新增顶层 MCP 工具**。
- 别名只用于人类/旧客户端兼容（如 `place` → `place_stone`），不作为教学入口。
- 拒绝分级：非法输入（越界、缺字段）→ 400；规则拒绝（占用、不是你的回合、压不过）→ 409；权限（旁观者）→ 403。

## 3. 阶段与连续动作

- 用 `turnState.phase` 表达阶段（`play`、`roll`、`buy`、`bid`、`scoring`…），`initialTurnPhase` 只描述开局阶段。
- 同一座位连续动作（飞行棋 roll→choose、大富翁 roll→buy→build→end）由插件保持 `currentPlayerId` 不变，只递增 `turnNumber` 或用阶段字段区分；平台不会替它换手。
- 阶段非法时的拒绝消息必须写清楚"现在能做什么"（如 `Roll the dice first`）。

## 4. 随机与可恢复

- 种子来自平台的 CSPRNG（`lib/csprng.ts`），**只在 `start()` 取一次**，把 RNG 状态写进 `state`。
- 每次随机推进 RNG 并把结果写回 state（骰点、洗牌后的牌堆/手牌、命运牌序）。
- 已接受行动的重试走幂等回执，不会二次掷骰；DO 重启读 state 里的结果，不会重掷。
- 公开的随机结果（骰点、抽到的牌面文案）进事件与投影；未公开的（牌堆顺序）只在 `state` 里。
- 测试用固定种子（`vi.spyOn(crypto,"getRandomValues")` 填零或显式传 seed），生产路径不改。

## 5. 多人 / 团队结果（M4.3 才落地）

现状：`winner: string | null`，`"draw"` 表示和局，归档 `winner` 是 `p1/p2` 形式的 ref。

斗地主（两农民同胜）与大富翁（并列身家）无法用单值表达。方案是**追加式**：

```ts
// BaseGameState 可选字段，只有需要多结果的游戏才写
outcome?: { winners: string[]; draw?: boolean; reason?: string };
```

- 归档文档新增 `winners: string[]`（缺省时**不写这个键**，旧文档逐字节不变）。
- MCP `game_ended` / `finalState` 增加 `winners`，`winner` 保留为 `winners[0]`（兼容旧客户端）。
- 前端 `MatchResult` 优先读 `winners.length`，回退到 `winner`。
- 验收：新增用例证明"只有 `winner` 的旧房间投影与归档完全不变"。

在 M4.3 之前，任何游戏都不得使用 `outcome`；需要多结果就先停下来实现它，而不是硬塞 `winner`。

## 6. 隐私

三处出口，缺一不可：

| 出口 | 覆盖 | 要求 |
| --- | --- | --- |
| `projectState` | 浏览器、广播、agent 富视图 | 只留观看者可见的字段；隐藏键由 `pluginProjection.test.ts` 用插件自己的声明反查 |
| `rewatchView` | 回放帧 | 默认全量揭示；带内部记账（如重复局面键）的游戏必须剥掉 |
| `broadcastProjection` | 公开直播 | 只放公开信息；新游戏若加入需要显式登记 |

手牌类游戏（跑得快、斗地主）额外要求：`agentDecision` 里对手只出现"张数"，不出现牌面；`legalActions` 由平台过滤，但"能不能出这手牌"的判断仍要服务端复核。

## 7. 公共接口变更的判定（六问）

新增任何钩子前必须写清：

1. 哪款游戏提出需求（**至少一款真实游戏**）。
2. 现有接口为什么表达不了（给出具体字段/调用点）。
3. 为什么不应由游戏内部解决（否则每个游戏复制一遍）。
4. 旧游戏如何保持行为不变（默认实现 / 缺省不写键）。
5. 对 MCP、存储、回放、UI 的影响。
6. 测试证据（新增用例名 + 失败时的样子）。

M4.0 的结论是：**八款游戏里没有一款需要新钩子**；唯一确定要动契约的是多座位结果，而它只影响 M4.3。

## 8. 测试策略

| 层 | 内容 | 何时写 |
| --- | --- | --- |
| 规则单测 | 胜负、非法输入、边界（长连、满盘、劫、重复局面） | 与规则同时 |
| 房间集成 | 开局、换手、拒绝不改状态、重启恢复、旁观只读 | 插件完成后 |
| MCP 全链路 | `agent_claim → create → join → start → action → wait → ended → archive → rewatch` | 每个游戏必须真的结束并归档 |
| 决策态 | `compactState` 形状 + 不泄漏对手私有字段 | 与 `agent.ts` 同时 |
| 金样本 / 等价 | 来源有测试的，逐条搬到本地用例；有确定性输入的，采集逐步状态比对 | 规则复杂时（chess/xiangqi/go） |
| UI | 四视口无横向溢出、主要操作可点、终局可见 | 每个游戏 |
| 视觉 | 与最接近的既有游戏对照截图（密度/留白/字号/圆角/棋盘比例） | 每个游戏 |

不允许"打到一半也算通过"：`gameJourney` 的每个脚本都必须走到 `game_ended` 并落归档。

## 9. 阶段顺序与退出条件

| 阶段 | 游戏 | 退出条件 |
| --- | --- | --- |
| M4.0 | — | 三份文档 + UI 规范；来源 SHA 与许可证记录 |
| M4.1 | gomoku | 规则/房间/MCP/归档/回放/四视口全绿；记录平台通用文件改动数 |
| M4.2 | aeroplane | 随机可重放（重试不重掷、重启不改点）、2–4 人、阶段切换 |
| M4.3 | paodekuai、doudizhu | 手牌隐私、`outcome` 扩展落地且旧文档不变 |
| M4.4 | monopoly | 多阶段 + 地图布局在手机端不破版 |
| M4.5 | chess、xiangqi、go | 走法正确性（含特殊规则）、围棋并行确认与投影体积 |
| M4.6 | — | 16 款全量回归 + 视觉统一 + 最终报告 |
