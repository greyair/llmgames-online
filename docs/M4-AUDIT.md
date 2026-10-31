# M4.0 审计：llmgames × West Window

- **主项目基线**：`9b0bda3`（M3 收尾 + 生产发布）
- **移植来源**：SerenQi/rain-go（西窗 / West Window）
  - commit `06e4b7515da709d3f5860ac37c4c3bddd00fce42`
  - 提交信息：`西窗 West Window · first public release`（2026-09-26）
  - 许可证：MIT，`Copyright (c) 2026 SerenQi`
  - 源码从独立临时目录读取，未拷入本仓库

这份审计只回答三件事：两套架构各自负责什么、八款游戏的规则实际长什么样、哪些东西不能直接搬。

## 1. 主项目现状（M3 之后）

八款游戏已经跑在同一份契约上：

```text
apps/workers/src/games/contract.ts      GamePlugin：规则、投影、行动、决策态
apps/workers/src/games/registry.ts      静态插件表（8 项）
apps/workers/src/durable-objects/       BaseGameRoom + 每游戏一个 ~100 行适配器
packages/game-catalog/                  id 联合、动作 schema、指令文案、清单
```

平台拥有的能力（插件不碰）：席位与房间生命周期、WebSocket、双时钟、幂等回执、持久化、终局投递、归档（R2 + D1）、回放帧、MCP 工具面、OAuth、观战、系列赛。

插件拥有的能力：初始状态、开局、合法意图、状态转移、按观看者的投影、agent 富视图与紧凑决策态、按游戏的超时策略。

**结论**：M4 不需要新引擎。新游戏 = 一个插件目录 + 一个房间薄适配器 + 注册面 + 前端棋盘。

## 2. 来源架构（West Window）

```text
packages/engine/src/match/types.ts      GameModule<S,V>：create/apply/waitingOn/outcome/seatLabels/view/describe/bot
packages/engine/src/games/              10 个游戏模块（含 poker、reversi）
packages/engine/src/coords.ts           GTP 坐标（列 A–T 跳过 I，行 1 在底部）
apps/web/src/games/<id>/                每个游戏一个 SVG/DOM 组件，无独立 CSS
```

三条关键约定（来自 `docs/ADDING-A-GAME.md`）：

1. **纯函数 + JSON**：`apply` 不改输入，返回新对象；状态里不含类、Map、Date。
2. **随机只来自状态内 RNG**：`create(ctx.seed)` 起手，之后用 `randomInt`/`shuffled` 推进，禁止 `Math.random`。
3. **隐私只在出口裁剪**：`state` 是全量的（含对手手牌、牌堆、RNG），`view(state, viewer)` 是唯一隔离层。

第 3 条对 llmgames 尤其重要：我们的 `state` 会被持久化并直接用于投影，所以移植时必须把"全量 state"留在服务端，投影一律走 `projectState`。

### 两套契约的字段对照

| West Window | llmgames | 说明 |
| --- | --- | --- |
| `create(ctx)` | `createInitialState()` + `start()` | 拆成"大厅态"与"开局"，因为房间先存在、后开局 |
| `apply(state, seat, move)` | `applyAction(state, playerId, intent, now)` | 文本行动改为结构化 `{actionType, data}`，校验更细 |
| `waitingOn(state)` | `turnState.currentPlayerId` / `mayActNow` | 单人轮转用前者；并行决策（围棋数子）用后者 |
| `outcome(state)` | `winner` + `match_ended` effect | `winners[]` 的多座位语义需要单独设计，见 M4-DESIGN |
| `view(state, viewer)` | `projectState(state, playerId)` | 观战者用空 id；广播另有 `broadcastProjection` |
| `describe(state, seat, names)` | `agentFields` + `agentDecision` | 富视图给 `get_state`，紧凑态给 `wait_for_turn` |
| `seatLabels(state)` | `seatIdentity` + 前端文案 | 标签是展示层的事 |
| `bot(state, seat)` | 不做 | 平台不托管机器人；规则可留作参考 |
| `options` | 房间配置 / 插件内常量 | 目前只有围棋尺寸、大富翁轮数值得做成选项 |
| `players {min,max}` | `minPlayersToStart` + `maxPlayers` | 座位上限由房间状态决定 |

## 3. 八款游戏的实际规则

| 游戏 | 源码 | 人数 | 选项 | 随机 | 私有信息 | 阶段/连续动作 |
| --- | --- | --- | --- | --- | --- | --- |
| gomoku | `games/gomoku.ts`（201） | 2 | 无 | 无 | 无 | 无阶段；一动作一换手 |
| aeroplane | `aeroplane.ts`（595）+ `-board.ts`（95） | 2–4 | `takeoff` 6/56 | `state.rng` | 仅隐藏 rng | `roll`→`choose`；同座位连续动作 |
| paodekuai | `paodekuai.ts`（321）+ `-cards.ts`（338） | 2–3 | 无 | create 洗牌 | 他人手牌、16 张弃牌 | 无阶段；`trick/passes` 跨动作 |
| doudizhu | `doudizhu.ts`（444）+ `-cards.ts`（495） | 3 | `hands` 1/3/6 局 | 每次发牌推进 | 他人手牌、底牌 | `bid`→`play`；一局多手牌 |
| monopoly | `monopoly.ts`（874）+ `-board.ts`（117） | 2–4 | `rounds` 20/40/0 | `state.rng` + `deck` | 牌堆顺序、rng、`riggedDice` | `roll`→`buy`→`end`；连续 build |
| chess | `chess.ts`（236）+ `-rules.ts`（421） | 2 | 无 | 无 | 无 | 无阶段；`result` 即终局 |
| xiangqi | `xiangqi.ts`（230）+ `-rules.ts`（390） | 2 | 无 | 无 | 无 | 无阶段；`result` 即终局 |
| go | `go.ts`（139）+ `record/board` | 2 | `size` 9/13/19 | 无 | 无（但对局记录全量） | `playing`→`scoring`；**两座位并行确认** |

逐款的移植要点：

- **gomoku**：`fiveThrough` 用"穿过落点的最长连线 ≥5"，自由规则（长连算胜）。坐标是 GTP（列 A–P 跳 I、行从底部数），结构化行动用零基 row/col，另给一个同口径的坐标标签供模型阅读。
- **aeroplane**：座位数决定颜色数组长度（2 人 `[0,2]`、3 人 `[0,1,2]`、4 人 `[0,1,2,3]`），不能硬编码 4 条跑道；一个回合内 roll → choose，掷 6 再 roll，三连 6 回机场；无棋可动时自动过手。
- **paodekuai**：2 人局各 16 张、余 16 张作废，3 人局 48 张全发且持 ♠3 者先手必须带 ♠3；`mustLead` 是跨动作约束。
- **doudizhu**：座位写死 3；一场可打 1/3/6 局，`outcome` 只在最后一局后给出累计分，可能并列（两农民同分）。这是"一局一终局"假设的正面冲突点。
- **monopoly**：一回合内 pay → roll → buy/skip → build\* → end；破产结算自动完成；`riggedDice` 是测试后门，移植时不能带进生产状态。
- **chess**：`history` 存重复局面键（三次重复判和），必须随状态持久化；SAN 消歧依赖完整合法着法表，结构化行动直接给 from/to/升变即可绕开。
- **xiangqi**：ICCS 记谱（`h2e2`），长将/长捉不判负；`quiet` 计 120 步判和。
- **go**：`apply` 里写 `Date.now()`，同输入不同时刻结果不同——移植时必须由平台传 `now`；数子阶段两座位并行 accept，`waitingOn` 会返回两个座位。

## 4. 绝不能直接搬的四样东西

1. **Match/Room 管理器**：席位、时钟、广播、持久化都在 llmgames 的 `BaseGameRoom`，搬过来等于造第二套房间。
2. **自由文本行动**：`"H8"`、`"bid 3"`、`"dead C3"` 这类解析留在来源里；平台侧必须是可发现、可校验的结构化字段。
3. **全量 state 直传**：来源前端拿到的就是 `view`，但它的 `view` 里仍有 `rng`、牌堆等字段被下游忽略；llmgames 的投影是安全边界，必须显式裁剪。
4. **前端样式体系**：来源是 Tailwind v4 + 内联 style + 一层 `styles.css`；llmgames 是 Mono Dither 设计系统（tokens + 语义类）。只借玩法与图形语言。

## 5. 平台侧需要新增的公共能力（预判）

| 需求 | 提出者 | 是否现在做 |
| --- | --- | --- |
| 一回合多动作（同座位连续 apply） | aeroplane、monopoly | **不需要**：现有 `applyAction` 不强制换手，插件自己决定何时 `currentPlayerId++` |
| 并行决策（两座位同时可动） | go 数子 | 需要时用 `mayActNow`；现有钩子已够 |
| 团队/多座位结果 | doudizhu（农民）、monopoly（并列身家） | 一次契约扩展，M4.3 落地（见 M4-DESIGN §5） |
| 游戏选项（围棋尺寸、大富翁轮数） | go、monopoly | 先做插件内常量；只有在第二个游戏需要同一选项时才上房间配置 |
| 结构化可恢复随机 | aeroplane、paodekuai、doudizhu、monopoly | 不需要新钩子：RNG 放 state，`createInitialState` 用 CSPRNG 起种子 |

**判定原则**：任何公共钩子上线前，必须回答 M4-DESIGN §7 的六个问题，并附测试证据。

## 6. 许可证与素材

- 规则代码：MIT，保留 `Copyright (c) 2026 SerenQi` 与许可全文（见 `THIRD_PARTY_NOTICES.md` 增补）。
- 素材：来源前端全部是内联 SVG/路径绘制，无外部图片、字体或牌面资源；llmgames 的棋盘、图标与插画为**自行绘制**，只借鉴布局与走子交互，不复制其渐变与玻璃质感。
- 数据：Contexto 的词表、宝可梦数据等既有第三方数据不受影响，本轮新增游戏不引入新数据集（围棋/象棋/五子棋均为纯规则）。
