# M4 迁移矩阵

来源：West Window `06e4b75`（MIT）。**已有 Reversi / Poker 不在移植范围**，只做规则差异记录（文末）。

## 1. 八款新游戏

| 游戏 ID | 来源文件 | 实际规则 | 人数 | 特殊阶段 | 私有状态 | 随机 | llmgames 映射 | 需要新公共接口 | 前端参考 | 测试范围 | 许可 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `gomoku` | `games/gomoku.ts` | 15×15 自由五子棋，≥5 连珠胜，满盘和 | 2 | 无 | 无 | 无 | `createInitialState`/`start`/`applyAction`/`agentDecision` | 否 | Reversi / Checkers 的棋盘容器 | 规则 + 房间 + MCP 全链路 + 4 视口布局 | MIT |
| `aeroplane` | `games/aeroplane.ts`、`aeroplane-board.ts` | 掷骰起飞、环行、跳/飞、撞子回机场、四机到家 | 2–4 | `roll` → `choose`，同座位连续动作 | rng | state 内 RNG，骰点写回并公开 | `applyAction` 内部不换手 + `agentDecision` 暴露 `phase/roll/choices` | 否（`mayActNow` 已够） | Battleship 的多席位布局 | 随机重放 + 3/4 人 + 撞子 + 超时 | MIT |
| `paodekuai` | `games/paodekuai.ts`、`paodekuai-cards.ts` | 2 人 16/16（余 16 作废）或 3 人 48 张全发；持 ♠3 先手 | 2–3 | 无 | 他人手牌、`mustLead` | create 洗牌后确定 | `projectState` 只给本人手牌 + 各家张数；`agentDecision` 用牌面元组 | 否 | Poker 的牌面组件 | 牌型/比较/Pass/隐私隔离/春天 | MIT |
| `doudizhu` | `games/doudizhu.ts`、`doudizhu-cards.ts` | 3 人，叫分 1/2/3，地主 + 两农民，可打 1/3/6 局 | 3 | `bid` → `play`，多局累计 | 他人手牌、底牌 | 每次发牌推进同一 RNG | 同上；结算用累计分 | **是**：多人/团队结果（M4.3） | Poker 的牌面 + 3 席位 | 叫分/牌型/团队胜/多局/隐私 | MIT |
| `monopoly` | `games/monopoly.ts`、`monopoly-board.ts` | 24 格环、8 组 16 块地、命运牌、监狱、破产、轮数上限 | 2–4 | `roll` → `buy` → `end`，连续 `build` | 牌堆顺序、rng（`riggedDice` 必须剔除） | state 内 RNG + 牌堆 | 多阶段 `applyAction` + `youFields`（现金/地契） | 否（**是**：若要"并列身家"为多人胜） | Battleship 的多席位 + 地图式棋盘 | 阶段状态机/破产/轮数终局/地图布局 | MIT |
| `chess` | `games/chess.ts`、`chess-rules.ts` | 标准国际象棋，含易位/吃过路兵/升变/三次重复/五十步 | 2 | 无 | 无 | 无 | `applyAction` 用 from/to/promotion；`history` 入 state | 否 | Checkers | 走法生成/特殊规则/和棋/棋钟 | MIT |
| `xiangqi` | `games/xiangqi.ts`、`xiangqi-rules.ts` | 中国象棋，蹩马腿/塞象眼/炮架/将帅照面，120 步判和 | 2 | 无 | 无 | 无 | 同上（ICCS → from/to） | 否 | Checkers | 走法/将军/困毙/和棋 | MIT |
| `go` | `games/go.ts` + `record/board` | 9/13/19 路，提子/气/禁入/劫/Pass/数子/死活确认/贴目 | 2 | `playing` → `scoring`（两座位并行 accept） | 无（记录含全部着法） | 无（`apply` 里的 `Date.now()` 必须移除） | `mayActNow` 支持并行；`phase=scoring` | 否 | Reversi | 提子/劫/数子/并行确认/投影大小 | MIT |

## 2. 每个游戏都要落地的清单（与 §1 的列一一对应）

- **后端**：`games/<id>/{rules,plugin,agent}.ts`、`durable-objects/<X>Room.ts`、`registry.ts`、`index.ts`、`types.ts`（Env）、`roomRouting.ts`、两份 wrangler 配置 + 本地配置、`migrations/00NN_<id>_active_rooms.sql`、`schema.sql`。
- **契约**：`packages/game-catalog` 的 `GameTypeId`、`GAME_LIFECYCLE`、`GAME_INSTRUCTIONS`、`GAME_ACTIONS`（含 6 个共享大厅动作的 `games` 数组）、`KNOWN_GAME_TYPES`、`GAME_AVAILABILITY`、`GAME_MANIFESTS`。
- **前端**：棋盘组件 + `boardRegistry`、`catalog.ts` 顺序、`gameRules`（en/zh）、`GameMark`、`GameScene`、`tokens.css` 调色板、`games.css` 身份、i18n 五键 + 无障碍名。
- **测试**：规则单测、房间集成（含重启）、MCP `gameJourney`、`agentDecisionState`、`gameToolCatalog` 顺序、`fixtures/game-spec.ts`、预览场景、`scenario-layout` 四视口。
- **文档**：`docs/M4.<n>-REPORT.md` 记录来源 SHA、改动文件、门禁结果、截图、遗留。

## 3. 已有两款游戏的差异记录（不替换）

| 项目 | llmgames 现状 | West Window 实现 | 结论 |
| --- | --- | --- | --- |
| Reversi | 8×8、`legalMoves` 服务端算好、无着法自动 pass、三次重复不判和 | 同为 8×8，`apply` 内算翻子，`waitingOn` 返回单座位 | 规则等价；不合并 |
| Poker | 德州单挑、多手牌、`stack_out` 终局、5 秒展示窗口 | `poker-table.ts` 486 行，多人桌 + 边池 | 语义不同（单挑 vs 多人桌），不合并 |
| 可借鉴 | — | Reversi 的 `flipCount` 预计算；Poker 的牌型排序表 | 记为后续独立任务，不在 M4 动 |
