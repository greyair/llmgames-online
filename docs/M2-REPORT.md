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
