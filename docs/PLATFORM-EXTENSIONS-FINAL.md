# 平台四项能力扩展：总报告

| 项 | 值 |
| --- | --- |
| 起点 SHA | `a4b51fdf068911f5c1a964d4a4843d60d21e74a7`（`origin/main` 同步，工作树干净） |
| 分支 | `main`（本地提交，**未推送**） |
| 提交 | 见第 2 节 |
| 状态 | 四项能力均已实现并带测试；第 6 节逐条区分"已实现/已测试/仅设计/未验证/暂缓" |

## 1. 一句话结论

四项能力都是**现有平台的轻量扩展**，没有第二套引擎、第二套房间系统或独立聊天服务：

```text
GamePlugin ──(ruleBot?)───────────────┐
     │                                  │
GAME_OPTIONS ──> 创建链路 ──> GameRoomConfig.options ──> GamePlugin.createInitialState
     │                                  │
BaseGameRoom ──(RoomChatService)───────┤ 聊天（独立 DO 内部模块，不入 gameState）
     │──(advanceRuleBots)───────────────┘ 规则 Bot（策略在游戏，调度在平台）
     │
MCP createServer ── send_room_message / get_room_messages / room_create(options)
     │
Web ── RoomChat / 选项表单 / 大厅 Bot / Live Sandbox
```

## 2. 提交

| 提交 | 内容 | 报告 |
| --- | --- | --- |
| `b746676` | `docs: audit and plan the four platform extensions` | `PLATFORM-EXTENSIONS-AUDIT.md`、`PLATFORM-EXTENSIONS-PLAN.md` |
| `a40a09f` | `feat(chat): add unified room chat and MCP messaging` | `CHAT-IMPLEMENTATION-REPORT.md` |
| `36f1219` | `feat(options): support per-game room options` | `GAME-OPTIONS-REPORT.md` |
| `4134820` | `feat(dev): add interactive game sandbox` | `LIVE-SANDBOX-REPORT.md` |
| `3da9f08` | `feat(bot): add rule-based game seats` | `RULE-BOT-REPORT.md` |
| （本文件） | `docs: close the platform extensions` | `PLATFORM-EXTENSIONS-FINAL.md` |

未推送 GitHub、未部署、未修改生产 wrangler、未开启 Actions。

## 3. 四项能力如何与既有系统共存

### 3.1 与 GamePlugin

- **聊天**完全不经过 `GamePlugin`：`chat_send` 与 `send_room_message` 都不调用 `applyAction`，因此不会触发规则重算、不推进回合、不写 replay 帧。
- **选项**只在 `createInitialState(config, …)` 这一处被读取（Go 的 `boardSize`、Aeroplane 的 `takeoff`、Monopoly 的 `roundLimit`）。规则的其余部分本来就在读这些状态字段，因此没有分支扩散。
- **Bot** 是 `GamePlugin` 的可选字段 `ruleBot`，与 `agentFields` / `agentDecision` 同级：同一个作者在同一个文件里写"人类看到的"和"Bot 用来决策的"策略。

### 3.2 与 MCP

| 能力 | MCP 侧 |
| --- | --- |
| 聊天 | 新增 `send_room_message`、`get_room_messages`（19 个工具）；身份经既有 controller → playerId 解析 |
| 选项 | `room_create` 增加可选 `options`；`list_game_tools` 返回 `gameOptions` |
| Sandbox | **不暴露**给 MCP（开发专用） |
| Bot | 不新增工具；`players[].bot` / `roomMembers[].seatKind: "bot"` 让模型知道这个席位不会回话 |

AI 规范快照（`apps/web/src/interface/content/ai-spec.json`）已重新生成，`pnpm check:ai-spec` 通过：19 个工具 / 16 个游戏目录 / 7 个 Jev 适配器。

### 3.3 与 Jev

Jev 的席位、凭据、调度、试用额度逻辑未改动一行。Bot 与 Jev 的区别在数据上是明确的：Jev 是 `hostedAgent: "jev"` + `isAgent: true`，Bot 是 `bot: true` + `channel: "bot"` + 无 Controller。两者可同房（各占一个席位），Jev 的既有测试全部保持绿色。

### 3.4 与未来的 Agent Runner

`wait_for_turn` 的长轮询语义没变，聊天也没有接入它（避免给每个 Agent 增加常驻等待器）。因此外部 Runner 仍然只需要：`agent_claim` → `room_join` → `wait_for_turn` → `send_action`，并可**额外**调用两个聊天工具。Runner 若想给 Bot 加"人格"，属于它自己的职责，平台不提供模型能力。

## 4. 测试与门禁（本次实际执行）

```bash
pnpm --filter @llmgames/workers test    # 106 files / 949 passed, 2 skipped
pnpm --filter @llmgames/web test        # 15 files / 576 passed
pnpm lint                               # oxlint 0 error、eslint 0 error、
                                        # CSS 令牌（60 个样式表）、严格类型、AI 规范一致
pnpm build:all                          # 6 tasks successful；46 页面
```

基线（`a4b51fd`）为 99 files / 855 tests（workers）。本次新增 **50 个用例**：

| 阶段 | 新增用例 |
| --- | --- |
| C1 | 19（会话级集成）+ 12（`RoomChatService` 单元）+ 5（前端契约） |
| C2 | 12（选项契约）+ 17（真实插件与房间）+ 5（选项文案） |
| C3 | 13（部署闸门、席位视角、私牌隔离、真实行动、协议形状） |
| C4 | 11（席位与调度）+ 10（三款策略与真实对局）+ 1（Bot 身份文案） |

推送前复审又补了 4 条：围棋 13/19 路的棋盘几何原本没跟着 `boardSize` 走（viewBox 写死 380），修复见 `GAME-OPTIONS-REPORT.md` 第 5.1 节；前端最终为 16 files / 580 passed。

## 5. 性能（实测，非估算）

| 指标 | 基线 | 现在 | 差 |
| --- | --- | --- | --- |
| Worker 上传体积（dry-run） | 17645.68 KiB | 17703.68 KiB | **+58.00 KiB（+0.33%）** |
| Worker gzip | 4194.82 KiB | 4210.17 KiB | **+15.35 KiB（+0.37%）** |

测量方式：`npx wrangler deploy --dry-run --config wrangler.json`，基线在 `git stash -u` 后测量，避免估算。

分阶段体积：C1 +26.07 / C2 +6.92 / C3 +10.95 / C4 +14.06 KiB。

其他：

- 前端生产产物**不包含**沙盒页面（`find dist -path "*dev/sandbox*"` 为空），聊天面板位于 `Room` 懒加载 chunk 内。
- 聊天每次发送：1 次 `INSERT` + 回执 + 2 次裁剪，同一 `transactionSync`；不触发 `saveState`、不排 alarm。
- Bot：一次唤醒最多 8 步，单步等于一次普通行动；Gomoku 单次决策约 900 次乘加。
- 19 路围棋单帧比 9 路多约 1.1 KB JSON，仍远低于 `MAX_REWATCH_FRAME_BYTES`(256 KB)。

## 6. 真实状态（严格区分）

### 已实现且已测试

- 同一房间的公共聊天：WebSocket 与 MCP 共享存储、序号、限流、幂等、旁观策略；断线按游标补取；聊天不改变回合/时钟/行动序号；帧内不含任何游戏私有状态。
- 规则选项：`go.size`、`aeroplane.takeoff`、`monopoly.rounds`；Web 与 MCP 同源校验；非法值 400；重启后一致；13 路可落第 13 行、5 点可起飞、20 轮按资产结算。
- Live Sandbox：真实房间 + 真实投影 + 真实行动；席位切换返回各自视角；斗地主三个席位互相看不到手牌、旁观无手牌；生产与非沙盒房间一律 404。
- Rule Bot：Gomoku 真人 vs Bot、Bot vs Bot 打到终局、Reversi Bot vs Bot 打到终局、Aeroplane 起飞与推进；无模型 Key；每步经 `dispatchAction`；单次唤醒 ≤ 8 步；可移除；策略无解时暂停并留痕。

### 已实现但本环境未演练

| 项 | 原因 | 复现方式 |
| --- | --- | --- |
| 1 真人 + 3 MCP Agent 的聊天联调 | 本环境无 MCP OAuth 客户端与浏览器会话 | `pnpm dev` + `pnpm --filter @llmgames/mcp-server start`，见 C1 报告第 5 节 |
| 沙盒页面内的实际点击流程 | 无浏览器会话（已用 `astro dev` + `curl` 验证路由 200） | 打开 `http://localhost:3000/dev/sandbox`，见 C3 报告第 5 节 |
| 真人 vs Bot 的浏览器对局 | 同上 | 创建 Gomoku 房间 → 大厅「添加规则机器人」→ 开始 |
| DO 真实重启后的 Bot 续跑 | 未做 kill-isolate 实测 | 状态与席位均已持久化，`advanceRuleBots` 只依赖 alarm |
| Aeroplane 4 人完整终局 | 数百步，测试代价过高 | 沙盒多席创建后连续行动 |

### 仅有设计

- `wait_for_room_event`（聊天与游戏事件的统一等待）。评估后未实现：现有 `wait_for_turn` 是进程内 Promise + 30s 上限，把聊天接进去等于给每个 Agent 加一个常驻等待器，与"不要为聊天建常驻任务"冲突。
- 沙盒的固定随机种子 / 动作脚本重放 / 脱敏 Fixture 导出 / Rich-Compact 双视图对照。

### 未验证 / 风险

- **`PokerRoom.restart.test.ts` 对恢复时序敏感**：本次在 `restorePersistedRoom` 增加一个独立 `await` 曾让它失败，改为与既有读取合并进同一个 `Promise.all` 后恢复。后续若在该路径加 await，需要重跑这条用例。
- Bot 的暂停状态只在内存：进程重启后 `botPaused` 清空，Bot 会再次尝试；失败会重复记录 `bot_stalled`。行为安全（不会无限循环），但诊断信息可能重复。
- 大富翁的 `rounds` 是按 `turns / 存活人数` 计算的既有定义，中途破产会让轮数跳变，因此轮数上限是"约 N 轮"。

### 暂缓（明确不做）

私信/群组/跨房社交、聊天写入 R2 回放、Agent Runner、新模型接入、AI 人格自动聊天、账户体系、第二套引擎/房间/聊天 Worker、外部数据库、插件市场、系列赛内 Rule Bot、生产自动部署。

## 7. 兼容性核对

| 项 | 结论 |
| --- | --- |
| 16 款游戏开局 | 未改动 `startGame` / `createInitialState` 的既有分支；全量回归通过 |
| 前端卡大厅（M4 问题） | `clientViewContract` 未收紧；沙盒会显式报告契约不符的字段路径 |
| 旧 MCP Controller | `agent_claim` / `room_join` / `get_state` / `wait_for_turn` / `send_action` 未改签名 |
| 旧房间 | 缺 `roomOptions` / 无 `bot` 席位 → 全部走默认分支 |
| 对局时钟 / 终局 / R2 归档 / 回放 | 未改动；Bot 行动是普通 `action` 事件 |
| D1 | 无迁移，无新表 |
| DO migration / Namespace | 未新增或移除任何 DO 类 |
| 生产 wrangler | `wrangler-prod.json` 未改；沙盒变量只出现在开发配置 |
| 浏览器旧 bundle | 新增消息类型与字段都是可选的，未知字段由 `.catchall` 保留 |

## 8. 未完成事项与下一次开发入口

1. **端到端联调**（最高优先）：用真实浏览器 + 3 个 MCP 客户端跑 C1 的四身份验收与 C4 的真人对局。需要的是环境，不是代码。
2. **系列赛继承选项**：`seriesConfigSchema` 增加字段，并在 `GameSeries` 创建对局时透传。
3. **`wait_for_room_event`**：若要实现，建议新增独立的长轮询端点，不改造 `wait_for_turn`。
4. **Bot 暂停的恢复入口**：`resume_rule_bot` 动作 + 大厅按钮。
5. **沙盒增强**：种子固定、脚本重放、Rich/Compact 对照端点。

入口文件：

```text
聊天      apps/workers/src/durable-objects/chat/RoomChatService.ts
选项      packages/game-catalog/src/options.ts
沙盒      apps/workers/src/api/sandbox.ts  +  apps/web/src/dev/Sandbox.tsx
Bot       apps/workers/src/durable-objects/BaseGameRoom.ts（advanceRuleBots）
          apps/workers/src/games/*/bot.ts
```

## 9. 交付物

```text
docs/PLATFORM-EXTENSIONS-AUDIT.md
docs/PLATFORM-EXTENSIONS-PLAN.md
docs/CHAT-IMPLEMENTATION-REPORT.md
docs/GAME-OPTIONS-REPORT.md
docs/LIVE-SANDBOX-REPORT.md
docs/RULE-BOT-REPORT.md
docs/PLATFORM-EXTENSIONS-FINAL.md   ← 本文件
```

## 8. 外部复审回应（2026-11-02）

外部静态审查提出 P0 一项、P1 两项、P2/P3 若干。逐条复核结果：

| 级别 | 问题 | 复核结论 | 处置 |
| --- | --- | --- | --- |
| P0 | Sandbox `/action` 未校验目标房间，可借调试接口操作普通房间 | **成立**。未修时对 `sandbox: false` 的房间发 `leave` 返回 200 且房主真的被移除 | 已修：房间新增 `/sandbox/action`，先过 `sandboxAllowed()`；路由改调它 |
| P1 | `advanceRuleBots` 设的 150ms 唤醒会被 `scheduleNextRoomAlarm()` 覆盖 | **成立**。`alarm()` 末尾就会重算一次 | 已修：Bot 到期时间并入最早 alarm 计算 |
| P1 | `botPaused` 只在内存，重启后丢失 | **成立**。原注释写着"故意不持久"，与"暂停到人工处理"的语义矛盾 | 已修：持久化并在恢复时读回 |
| P2 | 系列赛不继承游戏选项 | 成立，但属于功能缺口而非回归：系列赛 `series/setup` 不传 `options`，Go 一律 9 路 | 记录，未改 |
| P2 | 大富翁"轮"按存活人数折算，破产后轮数会跳 | 成立（`rounds = floor(turns / alive.length)`） | 记录，未改；改语义需要产品决定 |
| P2 | 聊天发送失败后草稿已清空 | 成立：`RoomChat.submit()` 立即 `setDraft("")` | 记录，未改 |
| P3 | 沙盒缺固定种子 / 脚本回放 / Fixture 导出 / Rich-Compact 对照 | 与原报告"暂缓"一致 | 未做 |

修复后门禁：`apps/workers` 107 文件 / 955 passed（2 skipped），`pnpm lint` 通过，`build:all` 46 页。三条回归用例都先确认过"去掉修复就会失败"，不是补一条永远为真的断言。

另外记一条复审没提的：`GAME_OPTIONS` 的可选值 13/19 路在服务端可用，但前端棋盘几何写死 9 路（`VIEW = 8*CELL + 2*MARGIN`），第 9 列之后画在画布外——已在 `e0e1e89` 修掉并补了 `goGeometry` 单测。

## 9. 第二轮复审（2026-11-02）

| 级别 | 问题 | 复核结论 | 处置 |
| --- | --- | --- | --- |
| P1 | `get_room_messages` 首次调用（不传游标）可能看不到最新消息 | **成立**。房间读取分支无条件调 `read()`，无游标被归一成 0，返回最旧一页 | 已修：无游标走 `recent(limit)` |
| P1 | Bot 暂停后没有对局内恢复入口 | **成立**。`remove_rule_bot` 只在 `waiting` 可用 | 已修：新增 `resume_rule_bot`，每席每局 3 次上限，`pausedBots` 投影 + 房主按钮 |
| P2 | Sandbox 只排除 production，其他层级默认开放 | **成立**。共享 staging 一旦打开 flag 就等于公开调试接口 | 已修：改为显式白名单（development / test） |
| P2 | `play_1v1` 提示"Never … chat mid-game"与允许 `send_room_message` 冲突 | **成立** | 已修：改成禁止在主会话解说，并明确房间聊天是另一条通道 |

四个修复都带回归用例，且先验证过"去掉修复就会失败"（聊天那条未修时返回 `[1, 2]` 而不是 `[2, 3]`）。

仍开放（与本轮无关）：系列赛不继承 `options`、大富翁轮数语义、聊天失败后不保留草稿、沙盒种子/回放/Fixture/Rich-Compact 对照。
