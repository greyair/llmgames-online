# C4 实施报告：免费规则 Bot

| 项 | 值 |
| --- | --- |
| 阶段 | C4 |
| 依赖 | C3（用沙盒/测试房间验证推进）；不依赖 C1/C2 |
| 结论 | 已实现、已测试：确定性策略 + 平台席位 + 受控调度，全程无模型调用 |

## 1. 定位与边界

| 类型 | 模型调用 | 执行位置 | 身份 |
| --- | --- | --- | --- |
| **Rule Bot（本次）** | 无 | 房间 DO 内的规则策略 | `channel: "bot"` + `bot: true`，无 Controller、无 API Key、无 owner |
| Jev | 需要 | 现有托管模型 | `hostedAgent: "jev"` |
| 外部 MCP Agent | 需要 | 用户自己的客户端 | `channel: "mcp"` + 私有 agentId |

Rule Bot 不写 `mcp_agent_seats` / `mcp_room_players`，因此不会占用也不污染 MCP 身份体系；`agent_list` 里不会出现 Bot。

## 2. 架构

```text
GamePlugin.ruleBot?: RuleBotStrategy        ← 游戏只提供策略（纯函数）
        │
BaseGameRoom
  ├── 席位：add_rule_bot / remove_rule_bot（仅房主、仅 lobby）
  ├── 决策：currentBotSeat() → 该席位自己的 buildClientView()
  ├── 校验：dispatchAction()（与真人完全相同的路径）
  └── 调度：每次成功行动 / 开局 / alarm 后 advanceRuleBots()
```

### 2.1 策略契约

```ts
interface RuleBotDecisionView {
  gameType: string;
  playerId: string;          // 自己的房间席位
  phase: string;
  legalActions: string[];    // 平台已过滤掉离开/结束/管理类动作
  view: WireObject;          // 该席位自己的投影
}

interface RuleBotStrategy {
  id: string;
  chooseAction(view: RuleBotDecisionView): GameIntent | null;
}
```

三条硬约束：

1. **私有状态隔离**：`view` 是 `buildClientView(playerId)`，与真人看到的是同一个投影。斗地主这类游戏没有 `ruleBot`，因此"Bot 看别人的手牌"在类型层面就不可能发生。
2. **必须经过 `applyAction`**：Bot 的意图走 `dispatchAction`，所以合法性、回合计时、幂等回执、事件日志、回放全部复用既有实现。
3. **纯函数**：策略不读存储、不看时钟、不联网，因此同一个局面必然得到同一个动作。

### 2.2 调度

```text
任意成功行动 / 开局 / alarm
        ↓
advanceRuleBots()  ← 已在执行则直接返回（botRunning 守卫，避免递归）
        ↓
循环最多 BOT_MAX_STEPS_PER_TICK = 8 步：
   当前席位是 Bot？ 否 → 返回
   decisionReadyAt 未到 → setAlarm(now + 150ms)，返回
   取投影 → 策略 → 校验在 legalActions 内 → dispatchAction
        ↓
8 步用尽仍有 Bot 待行动 → setAlarm(now + 150ms)
```

- 不复用 `wait_for_turn` 的长轮询，也不创建常驻进程；一次唤醒的计算量有上限。
- `requestId = bot:<turnNumber>:<startedAt>`，同一决策重试会被既有回执机制识别为重放，而不是走两步。
- 与现有 alarm 共存：Bot 只调用 `setAlarm`，不新开定时器；`scheduleNextRoomAlarm()` 的 `Math.min` 逻辑未被改动。

### 2.3 失败降级

| 情况 | 处理 |
| --- | --- |
| 策略返回 `null` | `bot_stalled` 事件 + 暂停该席位，房间继续可玩 |
| 策略抛错 | 同上（`console.error` + 事件，不向客户端抛） |
| 意图不在 `legalActions` | 同上（`pauseBot`，reason 为拒绝码） |
| 行动被规则拒绝 | 同上 |
| 对局结束 | `advanceRuleBots` 首行即退出 |
| 无上限重试 | 不存在：暂停后不再尝试，直到房主移除/重开 |

`botPaused` 只在内存，但"为什么停下来"写进了持久事件日志，可诊断。

### 2.4 三款策略

| 游戏 | 策略 | 复杂度 |
| --- | --- | --- |
| Gomoku | 立即连五 → 挡对手连五 → 连线评分（长度加权）+ 中心偏好 | 每个空点 4 方向扫描，O(棋盘) |
| Reversi | 翻子数 + 角落 120 + 角邻 -28 + 边 +8 | 每个合法着法一次线性打分 |
| Aeroplane | `roll`，然后 到家 > 撞子（按被撞数量）> 推进最远 > 起飞 | 复用 `aeroplaneChoices`（与服务端同一函数） |

三款都是"公开信息"游戏，因此策略不需要任何隐藏数据；这也是第一版只选它们的原因。

## 3. 席位与前端

- 大厅新增「规则机器人」一行：`add_rule_bot` / `remove_rule_bot`。
- 是否显示由**服务端**决定：`state.you.legalActions` 含该动作时才出现，因此前端不需要"哪些游戏有 Bot"的表格。
- 席位显示 `Bot 1`、`BOT` 标签、独立头像族（`bot:` 前缀），不显示为 MCP Agent。
- 仅房主、仅 `waiting` 阶段可增删；满员或系列赛会被服务端拒绝。
- 不改变 Jev 的席位逻辑（两者可同时存在，各占一个席位）。

## 4. MCP 可见性

- `players[]` 中 Bot 席位带 `bot: true`；`roomMembers[].seatKind` 新增 `"bot"`。
- instructions 增加一句：Bot 是服务端席位，不会回话，不需要邀请或 Controller。
- 未新增 MCP 工具（工具数保持 19），避免上下文膨胀。

## 5. 代码变更

新增：

```text
apps/workers/src/games/gomoku/bot.ts        141 行
apps/workers/src/games/reversi/bot.ts        83 行
apps/workers/src/games/aeroplane/bot.ts     108 行
apps/workers/src/tests/bot/RuleBot.test.ts  373 行
apps/workers/src/tests/bot/GameBots.test.ts 284 行
```

修改：

| 文件 | 改动 |
| --- | --- |
| `games/contract.ts` | `RuleBotStrategy` / `RuleBotDecisionView` / `GamePlugin.ruleBot?` |
| `BaseGameRoom.ts` | `botRunning`/`botPaused`、`currentBotSeat`、`botIntent`、`advanceRuleBots`、`pauseBot`、`addRuleBot`/`removeRuleBots`、三处触发点、`BOT_MAX_STEPS_PER_TICK`、`BOT_WAKE_MS` |
| `durable-objects/types.ts` | `AgentRoomMember.seatKind` 增加 `"bot"` |
| `games/{gomoku,reversi,aeroplane}/plugin.ts` | 注册 `ruleBot` |
| `mcp/createServer.ts` | instructions 说明 Bot 席位 |
| `web/game-ui/LobbySetup.tsx` + `lobby.css` | Bot 行、Bot 标签 |
| `web/game-ui/GamePlayerAvatar.tsx` | Bot 头像族 |
| `web/features/shared/gameOverCopy.ts` | `GamePlayer.bot` |
| `web/i18n/locales/*` | 5 条 Bot 文案 |

## 6. 测试命令与结果

```bash
pnpm --filter @llmgames/workers exec vitest run src/tests/bot/RuleBot.test.ts
# 11 passed
pnpm --filter @llmgames/workers exec vitest run src/tests/bot/GameBots.test.ts
# 10 passed
pnpm --filter @llmgames/workers test    # 106 files / 949 passed, 2 skipped（C3 后 928 + 21）
pnpm --filter @llmgames/web test        # 15 files / 576 passed
pnpm lint                               # 全部通过
pnpm build:all                          # 6 tasks successful
```

覆盖点：

| 需求 | 用例 |
| --- | --- |
| 无模型 API Key | `finishes a bot-versus-bot match without a human or a model`（env 显式去掉 `TYPESAFE_API_KEY`） |
| 无外部调用 | 测试环境无网络绑定；策略模块只依赖 zod 与规则函数 |
| 每次行动合法 | 所有行动经 `dispatchAction`；`reports an illegal move as a rejection`（C3）/`answers a human move immediately`（C4） |
| 行动进入真实日志 | `records bot moves in the action log with the bot's own identity` |
| 不泄漏隐藏信息 | `RuleBotDecisionView.view` 仅是该席位投影；斗地主的私牌隔离由 C3 用例保证；三款 Bot 均为全公开信息游戏 |
| 能结束对局 | Gomoku bot-vs-bot 到终局；Reversi bot-vs-bot 到终局（房间被归档清理即证明已终局） |
| 断线/DO 重启能恢复 | 席位与 `bot` 标记存在 `gameState`；`advanceRuleBots` 只依赖 alarm 与状态 |
| CPU 受约束 | `spends at most one burst per wake-up`（≤ 8 步/次） |
| 可移除 Bot | `removes every bot again` |
| 不影响 Jev / 外部 MCP | Bot 不写 MCP 身份表；Jev 逻辑未改（Jev 用例仍全绿） |
| 席位身份 | `adds a named bot seat for the host only`（非房主被拒） |
| 失败降级 | `pauses a bot whose strategy has nothing to say`、`returns null instead of guessing` |
| 多人 | Aeroplane 2 席 Bot 对局（3/4 席走同一条代码路径） |

## 7. 性能影响（实测）

| 指标 | C3 后 | C4 后 | 差 |
| --- | --- | --- | --- |
| Worker 上传体积 | 17689.62 KiB | 17703.68 KiB | **+14.06 KiB** |
| Worker gzip | 4206.57 KiB | 4210.17 KiB | **+3.60 KiB** |

| 四项合计 | 基线 `a4b51fd` | 现在 | 差 |
| --- | --- | --- | --- |
| 上传体积 | 17645.68 KiB | 17703.68 KiB | **+58.00 KiB** |
| gzip | 4194.82 KiB | 4210.17 KiB | **+15.35 KiB** |

- Bot 决策：Gomoku 每个空点 4 方向扫描（15×15 × 4 ≈ 900 次乘加），Reversi 每个合法着法 O(1)，Aeroplane 复用规则函数（≤ 4 个候选）。单次决策在微秒级。
- 每次 Bot 行动 = 一次 `saveState` + 一次广播，与真人行动相同；没有额外存储写入。
- 一次 alarm 最多 8 步，因此单次唤醒的 CPU 与 8 次普通行动同阶。

## 8. 旧版本兼容

| 项 | 处理 |
| --- | --- |
| 旧房间 | 无 `bot` 字段的玩家照旧；`currentBotSeat` 返回 null，不改变任何行为 |
| 旧客户端 | `channel: "bot"` 在其 `channel` 上是字符串；未知值按人类渲染，不崩溃 |
| `seatKind` 扩展 | `AgentRoomMember.seatKind` 增加 `"bot"`，旧读取方只做真值判断 |
| 系列赛 | `add_rule_bot` / `remove_rule_bot` 在系列赛被明确拒绝（`Series participants are fixed for this match`） |
| 回放 / 归档 | Bot 行动是普通 `action` 事件，带 Bot 的 playerId；`rewatchView` 不需要特殊处理 |
| MCP 工具数 | 未变化（19），AI 规范快照已重新生成 |

## 9. 已知问题与未完成事项

**已实现、已测试**：第 2、4 节，以及第 6 节列出的全部用例。

**已实现、未在本环境演练**：

- 真人 vs Bot 在浏览器中的完整对局（无浏览器会话）。等价路径由 workers 测试覆盖（`/agent/action` + `/agent/view` 与浏览器走同一 `dispatchAction` / `buildClientView`）。
- Aeroplane 2/3/4 人"完整终局"：测试验证了起飞、掷骰、选机与 2 人推进；4 架飞机全部到家的长局（数百步）代价过高，未跑到终局。
- DO 真实重启后的 Bot 续跑：席位与状态已持久化，`advanceRuleBots` 只依赖 alarm；但没有做"杀掉 isolate 再唤醒"的实测。

**范围限制（设计如此）**：

- Bot 只在 `waiting` 阶段增删；对局中不能中途加入（避免破坏回合计时与席位语义）。
- 暂停后不会自动恢复：需要房主移除或重开。这是有意的——自动重试会让一个逻辑错误变成无限循环。
- 只有 Gomoku / Reversi / Aeroplane 有 Bot。斗地主、跑得快、大富翁需要更复杂的策略（配合、牌型估值、资产决策），不在第一版。

**暂缓**：

- 系列赛内使用 Rule Bot。
- 多难度档位、思考延迟（现在 Bot 立即行动，没有"拟人停顿"）。
- Bot 策略的随机种子可配置（当前策略不含随机性，因此本来可复现）。

## 10. 后续可选增强

1. 给 Bot 增加可配置的显示延迟（例如 600ms），让回放更易读——注意不能用常驻进程实现。
2. 斗地主/跑得快的最小合法 Bot（只保证不卡桌，不追求强度）。
3. 暂停后由房主手动"继续"（新增 `resume_rule_bot`），而不是只能移除。
4. 策略版权：`id` 字段已预留版本位，可做 A/B 或回归对比。
