# M2 审计报告：多人游戏运行基础

- **审计对象**：llmgames-online（`main` @ `b25b0c8`）
- **审计日期**：2026-10-28
- **审计方式**：只读代码走查 + 现有测试用例盘点 + 本地执行 `pnpm lint` / `pnpm test`
- **审计范围**：`packages/game-catalog/src/index.ts`、`BaseGameRoom.ts`、`GameSeries.ts`、`mcpAgentControllers.ts`、`mcpAgentSeats.ts`、`mcpOAuth.ts`、`api/rooms.ts`、`mcp/createServer.ts`、`lib/seriesArchives.ts`、相关测试与 Wrangler 配置
- **标记口径**
  - **① 已有实现且测试充分**
  - **② 已有实现，但有边界问题或缺少测试**
  - **③ 尚未实现，确实需要开发**

## 0. 结论摘要

| 子项 | ① | ② | ③ | 结论 |
| --- | --- | --- | --- | --- |
| M2.1 房间生命周期 | 5 项 | 2 项 | 2 项 | 计时/清理/恢复机制完备；**生命周期不区分游戏与阶段**是主要缺口 |
| M2.2 身份权限 | 7 项 | 1 项 | 0 项 | 身份体系完整且测试扎实，只需补边界回归 |
| M2.3 断线并发 | 5 项 | 1 项 | 1 项 | 恢复与超时语义完备；**重复动作无幂等去重** |
| M2.4 回放归档 | 6 项 | 1 项 | 1 项 | 归档 outbox + 重试完备；**无"主动认输"动作** |
| M2.5 可观测性 | 1 项 | 1 项 | 3 项 | 仅有零散 `console.error` 与静态 `/health`，**无结构化事件与运维视图** |

**总体判断**：当前仓库不是"缺功能"状态，而是"平台骨架已成型、边界策略粗糙"状态。M2 的正确做法是把已有的计时器、alarm、outbox、controller 机制补齐边界，而不是新造系统。审计后确认需要开发的只有 4 处（见 §6），其余以补测试和补策略为主。

---

## 1. M2.1 房间生命周期

### 1.1 现状与证据

| 能力 | 标记 | 证据 |
| --- | --- | --- |
| 房间固定寿命 45 分钟 | ① | `packages/game-catalog/src/index.ts:31-34` `ROOM_LIFETIME_MS = 45 * 60 * 1000`；`BaseGameRoom.ts:4447` `expiresAt = createdAt + ROOM_LIFETIME_MS` |
| 5 分钟无活动清理 | ① | `index.ts:36-39` `ROOM_INACTIVITY_MS`；`BaseGameRoom.ts:4744-4754` `expireInactiveRoom()`；`4703-4741` alarm 取 `lastMeaningfulActivityAt + ROOM_INACTIVITY_MS` |
| 回合超时判定 | ① | `BaseGameRoom.ts:3541-3618` `settleExpiredTimers()`：先结算对局总时长 `time_up`，再结算单回合 `forfeit`；`3567-3569` 保留 `TURN_EXPIRY_GRACE_MS` 传输宽限 |
| 计时器随 DO 重建恢复 | ① | `466-548` 构造函数 `blockConcurrencyWhile` 恢复；`500-511` 用 `updatedAt` 作检查点扣减墙钟；`3490-3520` `syncRunningTimers()` |
| 结束房间的归档 outbox 重试 | ① | `515-522` 重开时 `setAlarm(now)` 立即重试；`4804-4884` cleanup 失败 `setAlarm(+60s)` |
| 废弃房间不留资源 | ① | `4900-4930` 先置空 `gameState` 再 `deleteAll()` + 释放 D1 目录；测试 `lifecycle.test.ts:165,186,358,378` |
| **统一 45 分钟上限，不区分游戏** | **②** | `4447` 永远 `createdAt + 45min`；`4449-4452` 还把 `timerConfig.gameTotalTime` 夹到 45 分钟。而各游戏默认对局时长本身已达上限：`BattleshipRoom.ts:384` 30 分钟、`PokerRoom.ts:152` 45 分钟、`ReversiRoom.ts:153` 20 分钟、`CheckersRoom.ts:109` 20 分钟、`Connect4Room.ts:111` 15 分钟 |
| **不区分 waiting / playing 阶段** | **②** | 同一 `applyRoomLifetimePolicy()` 在 `524`（构造恢复）、`579`（alarm）、`4705`（排程）、`4465`（创建）四处无条件使用 `createdAt`。后果：大厅等待的每一分钟都在扣对局可用时长。Poker 房间若在 lobby 等待 8 分钟再开局，45 分钟处会被 `alarm()` 以 `room_expired` 强制结束（`600-607`），而游戏内计时器此刻仍剩 ~8 分钟 |
| **按游戏类型配置生命周期** | **③** | 全文无 per-game 生命周期配置；`GAME_INSTRUCTIONS`（`index.ts:81-155`）只描述规则与超时语义，不含房间寿命 |
| **D1 目录过期时间可延长** | **③** | `lib/activeRooms.ts:70-89` `activateRoomCode()` 的 `WHERE ... status = 'creating'`，只能从 creating→active 一次性写入；`releaseRoomCode()`（`110-128`）按 `expiresAt` 精确匹配删除。因此延长房间寿命必须同步更新目录行，否则 cleanup 删不掉或早删 |

### 1.2 现有测试覆盖

- `apps/workers/src/tests/platform/BaseGameRoom.lifecycle.test.ts`
  - `347` "schedules inactivity cleanup after five minutes and caps room lifetime"：断言 `expiresAt === createdAt + ROOM_LIFETIME_MS`、alarm 为 `createdAt + ROOM_INACTIVITY_MS`、`gameTotalTime === ROOM_LIFETIME_MS`
  - `358`/`378` 等待中大厅 5 分钟清理（含 hibernatable socket）
  - `422`/`442`/`466`/`493` MCP `get_state`、重复 `rejoin`、`wait_for_turn` 超时均**不**续期活动
  - `843` 合法动作续期；`879` 对局中 5 分钟无动作被清理
  - `580` 时钟锚定：无周期消息、无多余存储写入，且 alarm 准点结算回合
  - `687`/`716`/`751` 宽限期内合法动作被接受、宽限后过期动作被裁决、总时长超时写入终局
- `apps/workers/src/tests/platform/RoomCreationExpiry.test.ts` 覆盖房码复用与过期回收

> 结论：**超时与清理语义有 14 个用例兜住**，改生命周期策略时必须保持这些断言成立（因此 waiting 阶段的 45 分钟大厅预算不做改动）。

### 1.3 判定

- 保留：`createdAt + 45min` 作为 **waiting 阶段**预算（不破坏 `lifecycle.test.ts:347`）。
- 需开发：**playing 阶段独立预算** —— 首个动作开始时锚定，长度由该局 `gameTotalTime` 决定，并按游戏类型设上限。
- 需开发：**D1 目录同步延期**，保证 `releaseRoomCode` 的 `expiresAt` 精确匹配仍成立。
- 不做：改动 `ROOM_INACTIVITY_MS` 语义（`lifecycle.test.ts:310,466,879` 明确要求超时结算不算活动，这是反挂机设计）。

---

## 2. M2.2 身份与权限

### 2.1 现状与证据

| 能力 | 标记 | 证据 |
| --- | --- | --- |
| 多 Agent 独立身份 | ① | `auth/mcpAgentSeats.ts:27` 每账号 32 个身份上限；`mcpAgentControllers.ts:184-207` `acquireMcpAgentController()` 为每个任务分配互斥身份；测试 `tests/auth/mcpAgentControllers.test.ts:22` "assigns different stored identities to concurrent task controllers" |
| Controller 不可冒用 | ① | `mcpAgentControllers.ts:210-244` 以 `controller_id + owner_user_id` 双条件续期；`281-311` `acquireMcpAgentWaitLease()` 用一次性 token 阻止同一 controller 并发等待，`313-328` 仅持有者可释放；测试 `mcpAgentControllers.test.ts:76` |
| 过期 controller 回收 | ① | `62-83` 仅回收"已过期且身份不在活跃房间"的行；`mcpAgentSeats.ts:356-379` `requireMcpAgentAvailable()` 拒绝一个身份同时进两个房间；测试 `mcpAgentSeats.test.ts:131,145` |
| 私密 agentId 不外泄 | ① | `007`/`023` 迁移（`0023_private_agent_ids.sql`）；`BaseGameRoom.ts:1031-1035,1086` 注释与实现；测试 `spectators.test.ts:632,668`（私有活动日志、legacy 身份字段均被剔除） |
| 房间操作权限隔离 | ① | `BaseGameRoom.ts:2641-2643` 非成员拒绝；`2669-2684` 旁观者仅可 `leave`（codenames 抢座例外）；`2888-2894` `end_game` 仅房主；测试 `spectators.test.ts:184,283,311,335,595` |
| 隐藏信息独立投影 | ① | `2916-2918` `projectStateFor()` 按玩家投影；`2924` `buildClientView()`；游戏侧覆盖见 `tests/platform/BaseGameRoom.agentProjection.test.ts:84,136,155,188,213`（浏览器全量、MCP 去元数据、Reversi/Poker/Codenames/Battleship 各自裁剪） |
| 浏览器身份由服务端注入 | ① | `api/ws.ts:23-31` 使用会话用户写入 `x-user-id` / `x-user-name`，客户端不能自选身份 |
| 邀请/加入/退出/恢复座位边界 | ① | `auth/agentWebhooks.ts` + `tests/platform/AgentWebhookInvites.test.ts`；`BaseGameRoom.ts:4020-4110` 房主迁移与离开后房主交接（无候选人则 `endGame()`） |
| OAuth 授权面 | ① | `mcpOAuth.ts:190-234` redirect_uri 仅允许 https 或 loopback；`324-344` DCR 限制 10 个回调；`487-488` 持久化 `code_challenge` + method；测试 `mcpOAuth.flow/redirectUri/cimd` |
| 观战者投影与玩家投影差异 | **②** | 观众走 `buildClientView(playerId)`，若某游戏 `projectStateFor("")` 与自身视角等价（多数无隐藏信息游戏如此）则无问题；但缺乏一个**跨游戏断言"观战者看不到任何玩家私有字段"**的集中测试，目前依靠各游戏单测 |

### 2.2 判定

- **不需要新系统**。现有 controller/seat 双层模型已经满足"多 Agent 独立身份 + 不可冒用"。
- 需补：一条集中回归测试，断言观战者与非当局玩家的投影不含私有字段（覆盖 Codenames key、Poker 底牌、Battleship 布雷、Contexto 个人猜测、Pokemon 手牌）。

---

## 3. M2.3 断线与并发恢复

### 3.1 现状与证据

| 能力 | 标记 | 证据 |
| --- | --- | --- |
| 页面刷新恢复 | ① | `api/ws.ts` 校验后转发给 DO；`BaseGameRoom.ts:2330-2360` 重连复用既有座位（`isReconnect`）且不续期活动；`2527-2534` `timer_sync` 立即回发全量视图 |
| MCP 重连 | ① | `handleAgentJoin`（`1088+`）幂等返回既有座位；`tests/platform/BaseGameRoom.lifecycle.test.ts:442` "does not renew inactivity when an already-seated MCP agent rejoins" |
| DO 重新实例化 | ① | `466-548`；`500-511` 用持久化检查点扣减墙钟后重排 alarm；测试 `221` "subtracts elapsed wall time when a playing room is restored" |
| 过期状态提交 | ① | `2645-2650` 派发前先 `settleExpiredTimers()`，过期动作被拒绝且状态已落盘；测试 `716,751` |
| 并发动作一致性 | ① | DO 单线程 + `blockConcurrencyWhile`（`639`、`468`、`706`）；`3522-3534` `timerTickRunning` 自旋锁；动作前统一结算 |
| 断线/等待超时 ≠ 对局结束 | ① | `2566-2605` 断线只标记 `player_disconnected`，不移除座位；`1898-1913` `wait_for_turn` 超时返回 `timedOut` 且不改状态 |
| **重复动作幂等** | **③** | `2469-2515` 的 `requestId` 只做**关联回执**（`action_result` + `acceptedRevision = eventSeq`），**没有去重表**：同一 `requestId` 重复提交会再次进入 `dispatchAction()`。`handleAgentAction`（`1366-1391`）甚至没有 `requestId` 入参，MCP `send_action`（`createServer.ts:1324-1387`）也不传 |
| 动作修订号 | **②** | `eventSeq` 作为 `acceptedRevision` 已下发（`2507`、`1382`、`1904`），但客户端与 MCP 均未把它当"状态版本"做条件提交，语义未被文档化，也缺"客户端落后于 revision"的测试 |

### 3.2 判定

- 不重写协议：在**既有 `requestId` + `acceptedRevision`** 上补去重，不改动作报文体格式（新增可选字段除外）。
- 需开发：WS 与 agent HTTP 共用的 `(playerId, requestId)` 短期结果缓存，命中即回放上次结论，不重复派发。
- 需开发：为 MCP `send_action` / `start_game` 增加**可选** `requestId`（纯增量，旧调用不变）。

---

## 4. M2.4 回放与归档

### 4.1 现状与证据

| 能力 | 标记 | 证据 |
| --- | --- | --- |
| 正常胜负归档 | ① | `BaseGameRoom.ts:4388-4438` `queueCompletedGameArchive()`；`lib/gameLogs.ts:88-139` 生成脱敏文档（玩家 id → 引用、`ownerUserIdHint` 剔除） |
| 规则触发超时 | ① | `3544-3565` `time_up` → `recordEvent("game_ended", {reason:"time_up"})` → 归档读 `archiveEndReason()`（`4371-4382`） |
| 多人游戏结束 | ① | Codenames/Poker 各自结束路径（`3017-3105` 分派）+ `GameSeries.test.ts`、`PokerRoom.multiplayer.test.ts` |
| 归档失败处理 | ① | `4424-4432` 失败置 `false`；`4870-4877` 保留 outbox 并 `setAlarm(+60s)`；测试 `BaseGameRoom.archive.test.ts:174,195,214`（广播目录失败、上传成功后再清库、重启后重试 outbox） |
| 回放不含未授权私有信息 | ① | 回放为 `visibility: "full_reveal"`（`1891`），**按设计在终局全量揭示**；归档文档同样全量但已做身份脱敏；站外读取受 `auth/gameLogs.ts` 与 `README.md:10`（私有回放）约束 |
| 系列赛归档 | ① | `lib/seriesArchives.ts:12-26` 先 R2 后 D1 索引；`GameSeries.test.ts:460` 覆盖 R2/D1 失败重试 |
| D1 索引失败（R2 已写入） | **②** | `lib/gameLogs.ts:200-240`：R2 put 成功后 D1 batch 失败会抛出并触发 outbox 重试，逻辑正确但**无专门测试**（现有归档测试只覆盖 R2 失败与广播目录失败） |
| **主动认输** | **③** | 全仓 grep `resign|surrender|forfeit|concede` 仅命中超时注释与 `forfeit` 广播原因（`3596`），**没有任何 resign 动作**。现有替代是房主 `end_game`（`2888-2894`，会把系列赛标记 `aborted`），对普通玩家不可用 |

### 4.2 判定

- 归档链路不需要重写。
- 需补：D1 索引失败用例。
- **需决策**：主动认输属于**玩法语义变更**（8 款游戏的胜负判定各不相同：Codenames 按队伍、Poker 多路底池、Contexto 按排名、Pokemon 按队伍剩余），超出"小范围兼容式修改"。审计建议单列，等你确认后再做，不擅自新增动作。

---

## 5. M2.5 运维与可观测性

### 5.1 现状与证据

| 能力 | 标记 | 证据 |
| --- | --- | --- |
| 健康检查 | ① | `app.ts:69-82` 静态 `/health`：仅返回 `status: "ok"` 与路由清单，**无任何运行指标** |
| 结构化错误日志 | ② | `app.ts:99-107` 全局 `onError` 只打 `REQUEST_FAILED` + 随机 requestId（刻意不打印异常对象）；DO 内为散点 `console.error`：`BaseGameRoom.ts:4412,4427,4864,4927,1393,3551` |
| 活动房间数量 | ③ | 数据源存在（`migrations/0017_active_rooms.sql`、`0027` `mcp_live_rooms`），但**无任何查询入口** |
| 正常/异常结束数量 | ③ | `game_logs.end_reason`（`0022`）已记录，**无聚合查询** |
| MCP 认证/行动失败 | ③ | 仅有 `console.error`，**无计数、无分类** |
| 状态恢复异常 | ③ | `500-511` 恢复逻辑无任何失败埋点（静默降级） |
| 归档失败 | ③ | 只有 `console.error`（`4427`），无计数 |
| Worker/DO/D1/R2 资源使用 | ② | Cloudflare 控制台原生提供，**无需自建**；但仓库未启用 `observability`（见下） |
| Wrangler 配置 | ③ | `apps/workers/wrangler.json` 全文 96 行：**无 `observability`、无 `triggers.crons`、无 Analytics Engine 绑定**；`src/index.ts` 只做导出，**无 `scheduled()` 处理器**，因此 `0043_storage_cleanup.sql` 的清理只能靠人工/脚本触发 |

### 5.2 判定

- 允许的手段：Cloudflare 原生（Workers Logs/`observability`、D1 查询、R2 元数据），**不引入** Redis/Prometheus/Postgres。
- 需开发：结构化事件日志（JSON `console.log`，禁止写入凭据/`agentId`/token）。
- 需开发：只读诊断端点，聚合 D1 既有表（`active_rooms`、`game_logs`、`mcp_live_rooms`），**不新增迁移**。
- 需开发：`observability` 配置写入开发配置与示例配置（生产配置文件 `wrangler-prod.json` 属你本地私有文件，**不由我改动**）。

---

## 6. 开发清单（按实际缺口）

| # | 子项 | 缺口 | 方案 | 兼容性 |
| --- | --- | --- | --- | --- |
| 1 | M2.1 | 生命周期不区分阶段与游戏 | 新增 `GAME_LIFECYCLE`（每游戏 `lobbyMs` / `playingMs`）；playing 阶段以 `playStartedAt` 锚定 | 旧房间无 `playStartedAt` → 回退当前行为 |
| 2 | M2.1 | 目录过期时间不可延长 | 新增 `extendRoomCode()`，与 `gameState.expiresAt` 同步更新 | 仅新增函数，`releaseRoomCode` 精确匹配语义不变 |
| 3 | M2.3 | 重复动作无幂等 | `(playerId, requestId)` 结果缓存 + 命中回放；agent HTTP/MCP 增可选 `requestId` | 纯增量字段，旧调用不受影响 |
| 4 | M2.5 | 无可观测性 | 事件日志 + `/api/v1/diagnostics`（会话鉴权 + `OPERATOR_USER_IDS` 白名单）+ `observability` 配置 | 白名单未配置时端点 404，功能默认关闭 |
| 5 | M2.2 | 缺集中隐私回归 | 新增跨游戏投影回归测试 | 仅测试 |
| 6 | M2.4 | 缺 D1 索引失败用例 | 新增归档测试 | 仅测试 |
| 7 | M2.4 | 无认输动作 | **待确认**（玩法语义变更） | — |

## 7. 明确不做的事

- 不改 `ROOM_INACTIVITY_MS` 语义、不改回合超时判定（`lifecycle.test.ts` 十余条断言依赖它们）。
- 不引入新的身份系统、不替换 OAuth、不改 controller/seat 数据模型。
- 不新增游戏、不做 GamePlugin 重构（M3）、不做 Agent Runner（M4）。
- 不新增 D1 迁移，不改迁移历史；不触碰生产密钥与 `wrangler-prod.json`。
- 不启用 GitHub Actions。
- 不新增 `resign` 动作（待确认）。
