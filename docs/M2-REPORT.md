# M2 实施报告：多人游戏运行基础

- **基线**：`main` @ `b25b0c8`（审计报告见 [M2-AUDIT.md](M2-AUDIT.md)）
- **完成日期**：2026-10-28
- **约束遵守**：未新增游戏、未做插件化重构、未引入 Agent Runner、未改迁移历史、未改生产密钥、未启用 CI、未部署

## 1. 结论

审计确认的 7 个缺口中，5 个已按"小范围、兼容式"方式补齐，1 个（认输动作）因属玩法语义变更暂缓待确认，1 个（MCP 认证失败计数）以结构化日志而非新表实现。

核心结论：**平台骨架本来就完好**（计时器、alarm、outbox、controller/seat 双层身份、投影隔离、归档重试都已存在且测试扎实），M2 的真实产出是把"统一 45 分钟房龄"改成"分阶段、按游戏类型的预算"，并补上动作幂等与运维可见性。

## 2. 已完成清单

### M2.1 房间生命周期（已完成）

**实际发现的问题**

1. `applyRoomLifetimePolicy()` 恒用 `createdAt + 45min`（`BaseGameRoom.ts:4447` 原实现），不区分 waiting/playing。大厅等待时间会直接吃掉对局预算：Poker 默认对局 45 分钟（`PokerRoom.ts:152`），大厅等 8 分钟即在第 45 分钟被 `room_expired` 强杀，而游戏内计时仍剩 8 分钟。
2. `timerConfig.gameTotalTime` 被按统一 45 分钟夹断，与各游戏默认时长（15–45 分钟）冲突。
3. D1 目录行 `active_rooms.expires_at` 只能由 `activateRoomCode()` 从 `creating` 写一次（`activeRooms.ts:70-89`），而 `releaseRoomCode()` 按 expiry 精确匹配删除（`110-128`）——延长寿命必须同步更新目录，否则清理会漏删。

**修改方案**

- 新增 `GAME_LIFECYCLE`（每游戏 `lobbyMs` / `playingMs`）与 `gameLifecycle()`（`packages/game-catalog/src/index.ts`）。
- `BaseGameState` 增加可选 `playStartedAt`（`durable-objects/types.ts`），开局时写入。
- `applyRoomLifetimePolicy()` 改为分阶段：waiting 用 `createdAt + lobbyMs`；playing 用 `playStartedAt + min(gameTotalTime, playingMs) + MATCH_END_GRACE_MS`。旧房间缺 `playStartedAt` 时自动回退原行为。
- 新增 `extendRoomCode()`（`lib/activeRooms.ts`），开局后同步 D1 目录过期时间，保证 cleanup 的精确匹配仍成立。
- **未改**任何回合超时判定与 `ROOM_INACTIVITY_MS` 语义（`lifecycle.test.ts` 十余条断言依赖）。

**修改文件**：`packages/game-catalog/src/index.ts`、`apps/workers/src/durable-objects/{BaseGameRoom,types}.ts`、`apps/workers/src/lib/activeRooms.ts`

**测试**

- `BaseGameRoom.lifecycle.test.ts` 新增「anchors a playing room at its first move…」「keeps a match that started late alive past the original lobby deadline」（后者模拟 20 分钟大厅等待 + 每分钟一步，跨过原 45 分钟大厅截止后仍为 `playing`，并验证 `/state` 仍 200）
- `RoomCreationExpiry.test.ts` 新增「per-game lifecycle budgets」
- `logic/activeRooms.test.ts` 新增「extends only the active row it owns…」「reports when there is no active row to extend」

**已知风险**

- 各游戏 `playingMs` 目前均 ≥ 45 分钟，因此**当前不会缩短**任何请求；真正的按游戏差异（Poker 90 分钟、Codenames/Battleship/Pokemon 60 分钟）只作用于房间上限而非对局时钟。
- `rooms.ts` 请求上限仍是 45 分钟。若要允许"Poker 开一局 60 分钟"，需要把 `createSchema.gameTotalTime.max` 改为按游戏取值——属对外契约变更，未擅自做。

### M2.2 身份与权限（验证完成，补 1 处测试）

**结论**：现有 controller/seat 模型已满足全部要求，仅补测试，未新建系统。

- 多 Agent 独立身份、controller 不可冒用、等待租约：`mcpAgentControllers.ts:184-328`，测试 `auth/mcpAgentControllers.test.ts`（4 例）
- 身份上限、活跃房间互斥、删除保护：`mcpAgentSeats.ts`，测试 `auth/mcpAgentSeats.test.ts`（10 例）
- 房主/旁观/座位边界：`BaseGameRoom.ts:2669-2684`、`2888-2894`，测试 `spectators.test.ts`（14 例）
- 私有投影：`BaseGameRoom.ts:2916-2924`，测试 `agentProjection.test.ts`、`PokerRoom.projection.test.ts`
- **新增**：`PokerRoom.projection.test.ts`「hides every hole card from a spectator seat」——断言旁观者视角下所有底牌均为 `?`，且不含牌面字符与牌堆。

### M2.3 断线与并发恢复（已完成幂等补齐）

**实际发现的问题**：`requestId` 只做回执关联（`BaseGameRoom.ts:2571+` 原实现），重复提交会再次进入 `dispatchAction()`；agent HTTP 路径与 MCP `send_action` 连 `requestId` 都没有。

**修改方案**

- `(playerId, requestId)` 短期结果缓存（TTL 5 分钟、上限 64 条，LRU 淘汰），命中即回放原始结论并标记 `replayed: true`，不再派发。
- WS `action_result` 与 agent HTTP 响应均可携带 `replayed`；错误回放走独立分支，不污染正常错误体。
- `POST /agent/action`、`POST /agent/start` 接受可选 `requestId`；MCP `send_action`、`start_game` 新增**可选** `requestId` 入参。
- 清理房间时清空缓存（`cleanup()`）。

**兼容性影响**：纯增量。未传 `requestId` 的调用行为完全不变；传了也不会改变动作语义，只是重复请求不再二次执行。MCP 工具 schema 新增可选项，AI 规格 `ai-spec.json` 已重新生成（仅新增 12 行 `requestId` 定义）。

**测试**：`BaseGameRoom.actionResult.test.ts` 新增 4 例——重复 id 不重复落子、重复 id 回放拒绝、不同 id 各自生效、agent HTTP 重试只执行一次。

### M2.4 回放与归档（验证完成，补 1 处测试）

- 正常胜负 / 规则超时 / 多人结束：`BaseGameRoom.ts:4388-4438`、`3544-3565`、`lib/gameLogs.ts:88-139`，测试 `archive.test.ts`、`GameSeries.test.ts`
- 归档失败重试链路（广播目录写失败、R2 上传失败、重启后 outbox 重放）：`archive.test.ts:174,195,214`
- **新增**：`archive.test.ts`「keeps the outbox when the D1 index fails after the R2 upload」——覆盖"R2 已写入但 D1 索引失败"的中间态：房间保留 outbox、定时重试、第二次成功后才清库，且对象键唯一不重复上传。
- **未实现**：主动认输（见 §3）。

### M2.5 运维与可观测性（已完成）

**修改方案（全部 Cloudflare 原生，无新基础设施、无新迁移）**

- 新增 `lib/observability.ts`：`logEvent(event, fields)` 输出单行 JSON，字段白名单为原始类型，敏感字段名（token/secret/credential/agentId/email 等）直接丢弃，长字符串截断 120 字符。
- 埋点位置：`archive_failed`（bindings / persist / directory）、`room_directory_failed`（extend / release）、`room_lifecycle`（room_inactive / room_expired）、`mcp_action_failed`、`request_failed`、`mcp_auth_failed`（仅在确实携带 Bearer 且被拒时，避免 OAuth 握手噪声）。
- 新增 `GET /api/v1/diagnostics`（`api/diagnostics.ts`）：24 小时窗口内活跃房间数（按游戏/状态分组 + 最老房间创建时间）、`game_logs` 按 `end_reason` 聚合并区分正常/异常结束、系列赛按状态计数。鉴权：会话 + `OPERATOR_USER_IDS` 白名单；未配置或不在名单内一律 404。
- `wrangler.json` 与 `wrangler-prod.example.json` 启用 `observability: { enabled: true }`。
- 文档：`docs/environment.md`、`apps/workers/.dev.vars.example` 增加 `OPERATOR_USER_IDS` 说明。

**测试**：`api/diagnostics.test.ts`（未配置 404 / 非白名单 404 / 聚合正确）、`logic/observability.test.ts`（脱敏与截断）。

**已知限制**：MCP 认证/动作失败的**计数**只能从 Workers Logs 按 `event` 过滤获得，未落表——落表需要新迁移，按约束未做。

## 3. 待决策 / 未完成

| 项 | 原因 | 建议 |
| --- | --- | --- |
| 主动认输 | 8 款游戏胜负语义不同（Codenames 按队伍、Poker 多路底池、Contexto 按排名、Pokemon 按队伍剩余），新增 `resign` 属玩法变更 | 确认后按"每游戏实现 `onResign(playerId)`"的方式加，先做 Connect4/Reversi/Checkers/Battleship 四个零和游戏 |
| 按游戏放开对局时长上限 | `rooms.ts` 校验上限仍为 45 分钟 | 若要放开，改为 `gameLifecycle(gameType).playingMs`，属对外契约变化 |
| 每个游戏差异化大厅预算 | 会破坏 5 条既有断言（`RoomCreationExpiry.test.ts:66`） | 保持 45 分钟，除非确认要改策略 |
| 定时清理缺少 cron | `wrangler.json` 无 `triggers.crons`，`src/index.ts` 无 `scheduled()` | 需要你确认是否启用（会影响部署配置） |
| 生产 `wrangler-prod.json` | 属你本地私有文件 | 需要你手动加 `observability` 与 `OPERATOR_USER_IDS` |

## 4. 验证证据

| 命令 | 结果 |
| --- | --- |
| `pnpm lint` | ✅ 8/8 turbo 任务；oxlint anti-slop 0 error（377 文件）；strict production type check 通过；AI 规格校验通过（17 MCP 工具 / 8 游戏 / 7 Jev 适配器） |
| `pnpm test` | ✅ 全包通过：workers **68 文件 / 581 用例**、web 9 文件 / 320 用例、mcp-server 10 用例 |
| `pnpm exec turbo run build --filter=@llmgames/web` | ✅ 30 页构建，47 个 JS/CSS 资产校验通过 |
| `wrangler deploy --dry-run --config wrangler.json` | ✅ 配置与绑定可解析（含新增 observability） |
| `pnpm build`（完整） | ⚠️ 未通过：`scripts/copy-web-dist.mjs:64` 清理 `dist/`（246 文件）被当前环境的批量删除保护拦截，非代码问题；web 编译阶段本身成功 |

基线对比：workers 用例 565 → 581（+16），web 320 不变，全部原有测试保留且通过。

## 5. 是否具备进入 M3（插件化游戏接口）的条件

**基本具备，但建议先补两件事**：

1. **接口边界已经清晰**：`packages/game-catalog` 现在是单一事实来源（动作 schema、agent 投影、系列赛契约、生命周期预算），8 款游戏都通过 `createDefaultState` / `handleGameAction` / `projectStateFor` / `onTurnTimeout` / `initialTurnPhase` 这几个钩子接入。M2.1 刚把生命周期也收进 catalog，正好是可插件化的第二个配置面。
2. **阻碍 M3 的实际问题**：
   - 各游戏仍有 `BaseGameRoom` 未抽象的隐含契约（例如 `ProjectionPokerRoom` 这类测试子类、Battleship 的 `agentDecisionReadyAt`、Codenames 的 `assignRoles` 时序）。插件化前需要把这些钩子显式列成接口。
   - 缺少一个"新游戏最小实现"的可执行验收用例。建议 M3 第一步先补一个 `fixtures/minimal-game.ts`（仅实现必需钩子）跑通一局，再动插件注册表。

**判定**：可以进入 M3，但第一步应为"钩子契约固化 + 最小游戏夹具"，而非直接改写 8 款游戏的注册方式。

## 6. M2.6 复审修正（外部代码复审后追加）

外部复审指出两处 P0 与一处 P1，逐条核实后确认成立，已修正；两处 P2 中一项实现、一项按游戏补测试。

### 6.1 幂等记录持久化（P0-1，已修；第三轮复审后改为真正原子）

**问题**：`ackedActions` 最初只存在于实例内存，DO 重建后同一 `requestId` 会重新派发。第二轮改为"回执单独一次写入"，仍存在"动作已落盘、回执未落盘"的间隙。

**最终方案（第三轮复审后）**

- `saveState()` 的一次 `put` 同时写入 `gameState`、`ackedActionRecords` 与 `directoryExpiryPending`。
- 成功的动作在**这次写入之前**把回执放进内存（`rememberAckedAction()`），因此"动作生效"和"回执存在"不可分割：要么两者都在磁盘上，要么都不在。
- 写入失败时 `saveAppliedAction()` 会从存储回滚内存状态（`storage.get("gameState")` 重新载入并重建回执表），返回 500。此时磁盘上既没有动作也没有回执，调用方重试只会执行一次。
- 被拒绝的动作不改变状态，因此走 `persistRejection()` 单独写入回执，无需与状态配对。
- 实例重建时 `restoreAckedActions()` 恢复回执，过滤过期项并按上限截断。

**仍然存在的边界**：回执表受 5 分钟 TTL 与 64 条上限约束，超出窗口的 `requestId` 不再去重；崩溃后重放依赖该记录存在。因此对外应描述为"在去重窗口内实现原子幂等"，而不是全局 exactly-once。

**测试**：`「rejects the action when state and receipt cannot be written together」`——写入被拒绝时返回 500、内存回滚为空盘、重启后棋盘仍为空、同一 `requestId` 重试恰好生效一次且再重试为 `replayed`。

### 6.2 房间目录延期失败（P0-2，已修）

**问题**：`extendRoomCode()` 返回的布尔被忽略；且方法只在 `startGame()` 调用一次，注释里说的"下一次保存重试"并不存在。

**修正**

- `extendRoomCode()` 改为返回 `"extended" | "current" | "missing"`，且 SQL 带 `AND expires_at < ?` 单调前进——旧房间的延迟更新不可能缩短或劫持被复用的房码。
- `extendDirectoryExpiry()` 处理三种结果：`extended`/`current` 视为成功；`missing` 先尝试用 `reserveRoomCode` + `activateRoomCode` **重建目录行**；抛错则持久化 `directoryExpiryPending` 标记。
- `saveState()` 在标记存在时重试延期，因此 D1 短暂故障会在下一次动作/计时结算时自愈；实例重建时也会读取该标记。
- 新增 `room_directory_repaired` / `room_directory_failed` 事件。
- **第三轮复审补修**：原实现"先存开局状态、再延长目录"，若两步之间实例重启，没有任何标记说明目录落后，长局过期后房码会失效。现在开局时会**先把 `directoryExpiryPending = true` 与状态写进同一次 `put`**，再尝试延长；`restorePersistedRoom()` 在恢复结束时若发现该标记会主动补做一次，因此静止房间也能自愈。
- **第二轮复审补修**：原实现按 `status='active'` 判断"缺失"，若某次"预留成功、激活失败"留下了 `creating` 行，下一轮会被误判为"缺失"，而 `reserveRoomCode` 又因未过期而返回 null，导致 pending 被清除、目录永久停在 `creating`。现在 `missing` 分支先 `readRoomCode()` 读取真实行：同一 roomId 的 `creating` 行直接补做激活；其它 roomId 的占用则记录 `room_directory_conflict` 并放弃；只有真正没有行时才重新预留。

### 6.3 requestId 动作冲突（P1，已修）

同一 `requestId` 现在绑定动作指纹（`actionType` + 规范化 JSON，键序无关）。同 id 同动作 → 回放；同 id 不同动作 → 不再回放首次结果，返回 `IDEMPOTENCY_CONFLICT`（HTTP 409，WebSocket 回执带 `code`）。

### 6.4 诊断接口（P2，已修）

- 响应增加 `Cache-Control: no-store`。
- `series` 计数明确标注 `scope: "all_time"`，与 24 小时窗口的 `games` 区分。
- `state_restore_failed` 从"声明"变为"实际产生"：`BaseGameRoom` 的状态恢复逻辑抽成 `restorePersistedRoom()`，失败时先记事件再抛出，重启循环在日志里可见。

### 6.5 私有投影测试矩阵（P2，部分补齐）

新增 `tests/platform/privateProjection.test.ts`：Codenames 的 key 对 operative 与旁观者均为 `null`、仅 spymaster 可见；Contexto 进行中不投影 `secret`，且任何投影都不含 `rankTable`。结合既有的 Poker 底牌测试与 `agentProjection.test.ts`（Battleship 水雷、Pokemon 手牌），四类隐藏信息已有覆盖。Battleship 舰队坐标仍依赖既有测试，未单独加旁观者用例。

### 6.6 复审未采纳的建议

- **恢复"下一次保存重新校验目录"更频繁的 alarm 重试**：未采纳。改为挂在 `saveState()` 上，避免 D1 故障期间用 60 秒 alarm 抢占回合结算。
  代价（复审指出，成立）：**没有任何后续写入的房间不会重试**。房间一旦有动作或计时结算就会走 `saveState()`；完全静止的房间只能等下一次 alarm 或实例重建。这是刻意的权衡，不另建轮询。
- **主动认输**：维持延后，理由与复审一致（每游戏结算语义不同）。

### 6.7 复审后验证

| 命令 | 结果 |
| --- | --- |
| `pnpm test`（workers） | **592 用例**通过（第二轮复审前 588，新增 4） |
| `pnpm lint` | 8/8 任务、anti-slop 0 error（380 文件）、strict type check、AI 规格校验全部通过 |
| 新增测试 | 第一轮：`BaseGameRoom.idempotency.test.ts`（重启重放、冲突拒绝、键序无关）、`BaseGameRoom.directory.test.ts`（失败重试、缺失重建）、`privateProjection.test.ts`（Codenames key、Contexto secret）。第二轮：目录测试新增「预留成功但激活失败后自愈」「不抢占他人房码」，幂等测试新增「回执写入失败不谎报失败」并固化非 Exactly-once 边界，`api/rooms.test.ts` 新增按游戏放开时长 |

## 7. 对局时长按游戏类型放开（第二轮复审后追加）

**背景**：复审指出 M2.7 里"60 分钟 Poker"无法验证，因为 `rooms.ts` 仍以全局 `ROOM_LIFETIME_MS`（45 分钟）为上限。这与 M2.1 引入的 `playingMs` 自相矛盾：预算写到了 90 分钟，入口却不让选。

**修正**

- `game-catalog` 新增 `maxGameTotalTimeMs(gameType)` 与 `MAX_GAME_TOTAL_TIME_MS`（当前为 90 分钟，即所有游戏声明值的上界）。
- 创建房间 Schema 的上限改为 `MAX_GAME_TOTAL_TIME_MS`；解析出 `gameType` 后，再按该游戏的 `playingMs` 校验，超限返回 400 与明确文案（`Match length for connect4 is limited to 45 minutes`）。Schema 层只做"未知游戏类型之前"的粗筛，避免把所有游戏都锁在 45 分钟。
- Web 创建表单的时长选项由 `MATCH_MINUTES`（10/15/20/30/45/60/90）按当前游戏过滤；`connect4` 仍是 10–45，`poker` 出现 60/90，`codenames`/`battleship`/`pokemon` 到 60。
- MCP `room_create` 与本地 stdio 桥接同步放开上限，并在 worker 侧按游戏校验（桥接只做粗筛，权威判断留在服务端）。
- `ai-spec.json` 重新生成：`room_create.gameTotalTime.maximum` 由 `2700000` 改为 `5400000`，并新增说明。

**兼容性**：只放宽上限，原有 ≤45 分钟的请求行为不变；超过所属游戏上限的请求从"被通用 400 拒绝"变为"被具体游戏的上限拒绝"，文案更明确。

**新增测试**：`api/rooms.test.ts`「accepts a longer match only where the game declares that budget」——`poker` 接受 90 分钟，`connect4` 拒绝 60 分钟并返回确切文案。

**M2.7 验收口径随之更新**：可以直接验证 60/90 分钟 Poker 长局，不再需要绕开 API。

### 6.8 开局失败重试丢失错误（第三轮复审，已修）

**问题**：`POST /agent/start` 回放失败回执时返回 HTTP 200 且不带原始错误（`{ ok: false, replayed: true, state }`），MCP 客户端会把重试当成普通成功响应。

**修正**：回放分支区分成功与失败——失败走 `agentActionErrorResponse()`，返回原始错误类别、消息与 `replayed: true`；成功才返回 200。

**测试**：`「replays a failed start as a failure, not an empty success」`——单人房间开局（应当被拒），首次返回 409；用同一 `requestId` 重试仍返回 409，`replayed: true`，错误消息包含 "at least"。

## 8. 归档详情读取契约修复（线上缺陷）

**现象**：历史记录能列出对局（数据来自 D1 `game_logs`），但点开详情报 `Game log document has an invalid shape`。

**根因**：前端用**列表**的参与者 Schema 校验 **R2 归档文档**，两套契约不同。

| 字段 | R2 归档（`lib/gameLogs.ts`） | 前端文档校验（修复前） |
| --- | --- | --- |
| 玩家名 | `name` | `displayName`（必填） |
| `codename` / `environmentLabel` / `ownerGamertag` | 有值才写 | 必须存在（可 null） |

用线上真实归档验证（reversi，2 名参与者、182 事件、61 帧）：

```
new schema : PASS
old schema : FAIL ["participants",0,"displayName"]
participant keys: ref,name,isAgent,codename,environmentLabel,ownerGamertag
```

**修复**

- 新增 `packages/game-catalog/src/game-log-document.ts`：`archiveParticipantSchema` / `gameLogDocumentSchema`，作为归档文档的**唯一契约**，写入端与读取端共用。
- 前端 `services/auth.ts` 的 `documentSchema` 直接引用该契约，`AgentGameLogDocument.participants` 类型随之改为 `name`；D1 列表仍用原有 `participantSchema`（`displayName`），两套契约不再混用。
- 写入端在 `buildCompletedGameArchive()` 内用 `archivedParticipantsAreReadable()` 校验参与者；不符合只记 `archive_contract_violation` 事件，不阻断归档。
- e2e 假数据改为按归档契约构造（此前直接复用列表数据，导致测试通过而真实记录打不开）。

**不需要**重写历史：R2 中文档一直是 `name` 形状，改读取端即可。已用线上真实对象验证可解析。

**测试**：workers `「builds a document that the history reader accepts」`；web `archive-document.test.ts` 三例（写入形状通过、旧归档 null 通过、列表形状被拒绝）。
