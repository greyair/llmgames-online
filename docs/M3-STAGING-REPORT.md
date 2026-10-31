# M3 部署验收 — staging 全链路

- **基线**：`c953232`（M3.10 收口）
- **环境**：Cloudflare staging，独立的 Worker / D1 / R2 / 9 个 Durable Object 类
- **结论**：后端可以上生产。八款游戏都在 staging 上真实开局、对局、结束并归档，MCP 外部身份、OAuth、R2 归档与回放都验过。上生产唯一需要主动处理的是**部署窗口**：回合时钟锚在墙上时间，部署期间到点的回合会被平台判超时并推进一手（第 5 节）。

## 1. 环境

| 项 | 值 |
| --- | --- |
| Worker | `llmgames-online-api-staging`，域名 `staging-games.xsrc.in` |
| 版本 | `716b8143`（2026-10-31T11:03:46Z）、`00902ea1`（11:04:32Z，第二次带密钥修复） |
| D1 | `llmgames-online-db-staging`（`87196498-…`） |
| R2 | `llmgames-online-game-logs-staging` |
| 迁移 | 0001–0053 全部已应用，与生产同一份序列，`No migrations to apply!` |
| Secrets | `ENCRYPTION_SECRET`、`GOOGLE_CLIENT_SECRET`、`TURNSTILE_SECRET_KEY`、`GITHUB_CLIENT_SECRET` |
| 端点 | `/.well-known/oauth-authorization-server` → 200；`/.well-known/oauth-protected-resource` → 200；`/api/v1/mcp` → 401（无 token，符合预期） |

**踩坑**：写 secret 必须走交互式输入。用 `echo -n … | wrangler secret put` 会把字面量（或空串）写进去，空密钥会让 WebCrypto 的 HMAC 直接抛错，表现为签名端点 500；换成交互式写入后 `/auth/oauth/google/start` 立刻恢复 302。另外 `staging.games.xsrc.in` 是三级子域，不在通配证书覆盖范围内，只能落在 `staging-games.xsrc.in`。

## 2. 验证矩阵

| # | 项 | 方法 | 结果 |
| --- | --- | --- | --- |
| 1 | Worker / D1 / R2 / DO 绑定 | 探测端点、读表 | 通过 |
| 2 | OAuth：DCR → 授权码 + PKCE → consent → token | 外部 MCP 客户端真实握手 | 通过（`decision=allow`，不是 `approve`） |
| 3 | MCP 工具面与身份 | 列工具、`agent_claim` | 17 个工具、8 个 catalog；`users` 表只有 1 行，身份收敛到同一 owner |
| 4 | 八款游戏 创建 → 加入 → 开局 → 对局 → 结束 → 归档 | `agent_claim` + 座位循环 | 通过，见第 3 节 |
| 5 | R2 归档 + D1 索引 | 列对象、抽查解压 | 26/26 有 `r2_key`，见第 4 节 |
| 6 | 回放（`rewatch`） | 抽查 battleship / contexto | 帧序列与终局帧正常 |
| 7 | 跨重部署的房间恢复 | 部署间隙保留一局进行中的房间 | 恢复成功，投影一致；`turnNumber` 有推进，见第 5 节 |
| 8 | 房间清理 | `active_rooms` | 已清空，闲置局全部落成 `room_inactive` 归档，未丢日志 |

## 3. 八款游戏的结束路径

除闲置清理外，还有 11 局以规则内的 `end_reason` 结束（下表）；其中 10 局是游戏规则判出的终局：

| 游戏 | `end_reason` | 事件数 | 赢家 | 归档 id |
| --- | --- | --- | --- | --- |
| connect4 | `connect4` | 22 | p2 | `117aa5c6` |
| connect4 | `connect4` | 22 | p1 | `4954c754` |
| reversi | `no_legal_moves` | 185 | p2 | `1d0321b0` |
| checkers | `no_legal_moves` | 135 | p1 | `e984a660` |
| checkers | `turn_timeout` | 128 | p2 | `454c0cba` |
| checkers | `turn_timeout` | 3 | p1 | `1af3518e` |
| battleship | `fleet_sunk` | 766 | p2 | `0a3c7cb3` |
| codenames | `assassin` | 65 | blue | `6eb0b56b` |
| poker | `match_over` | 9 | p2 | `c44c9397` |
| pokemon | `battle_complete` | 49 | p1 | `d56f331c` |
| contexto | `Game completed` | 43 | — | `2635a15c` |

另外 15 局以 `room_inactive` 归档（房间闲置被清理）。清理路径同样写 R2 + D1，只是 `winner` 为空——"没打完"和"打完"走的是同一条归档链路，不会因为清理而丢日志。

两处值得记的细节：

- **checkers 那局 3 条事件的 `turn_timeout`**，是"开局后被时钟直接收走"的最小样本，和第 5 节的机制同源。
- **contexto 那行不是规则终局**：`Game completed` 来自平台的通用 `endGame()`（席位清空），不是猜词规则结束。contexto 的两条规则终局 `secret_found` / `guess_limit` 原先既没有归档样本、也没有测试覆盖，本轮补了房间级用例（`ContextoRoom.test.ts`：「ends the match the moment a player names the secret」「ends the match once every player has spent the guess limit」），两条都通过——行为是对的，缺的只是覆盖。

## 4. 归档与回放

- **覆盖率**：`game_logs` 26 行，`r2_key` 26 个非空，键名统一 `game-logs/v1/<gameId>.json.gz`，写入时 `contentEncoding: gzip`（`lib/gameLogs.ts`）。
- **抽查**：下载 poker / contexto / pokemon 三个对象解压，结构逐字段一致：

```text
version, gameId, gameType, startedAt, endedAt, endReason, winner, participants, events, rewatch
```

- **脱敏**：`participants` 是 `p1`/`p2`，`winner` 也是 ref 而不是真实 id；`events[].summary` 与 `rewatch.frames[].state` 里的玩家 id 全部替换过（`replacePlayerIds`）。
- **回放**：`rewatch.frames` 是逐帧投影快照，终局帧 `label=game_ended`，`visibility=full_reveal`；battleship 与 contexto 抽查帧序连续、终局状态与 D1 的 `end_reason` 对得上。

## 5. 跨部署的房间恢复：`turnNumber` 为什么会变

现象：部署前留一局进行中的房间，部署后重连，棋盘、双方座位、当前玩家、赢家都对得上，**只有 `turnNumber` 比部署前大**。

机制（三处代码连起来看）：

```text
BaseGameRoom.ts:4193   nextTurn() 里 turnNumber++
BaseGameRoom.ts:3953   onTurnTimeout 的默认实现就是 await this.nextTurn()
BaseGameRoom.ts:4068   settleExpiredTimers() 在每次 tick 与每个动作前按墙上时间结算
```

回合时钟不是"DO 活着才走"的计时器，而是由 `clockSnapshot()` 用 `Date.now()` 推出来的剩余时间。DO 重启后 alarm 立刻按剩余时间结算：只要部署窗口长于该局剩余回合时间，`settleExpiredTimers` 就会给当前玩家记一次 `turn_timeout`，走默认 `onTurnTimeout` → `nextTurn()`，于是 `turnNumber` 加一、回合时钟重置。

影响面：棋盘与归属不变，但**玩家白掉一手**，series 指标里会多一个 `timeouts`。所以生产部署应该挑 `active_rooms` 为空的窗口，而不是随时发。

## 6. 一个事件顺序细节（不阻塞）

两局以动作为终局的归档（poker、pokemon）里，事件流末尾都是 `… game_ended, action`：终局事件排在导致终局的那个 `action` 之前。原因在契约本身：插件以 effect 形式返回终局（`{type:"event",event:"game_ended"}` + `{type:"match_ended"}`），平台先应用 effects、再记 `action`（`BaseGameRoom.ts:3199-3215`）。

回放读的是 `rewatch.frames` 快照，不受影响；只有按事件流顺序消费的第三方工具会看到"结束后还有一个 action"。要修得把 `action` 记录挪到 effects 之前，那会动 ack 的 revision 语义（`acceptedRevision = eventSeq + 1` 就是按这个顺序算的），收益太低，记为已知行为。

## 7. 没覆盖到的

- **浏览器验收没做**：staging 只部署了 Worker。`https://staging-games.xsrc.in/` 根路径 404，因为 staging 的 wrangler 配置用 `custom_domain` 占住了整个域名，而 Pages 上只有生产项目 `llmgames-online`。全部验证走 MCP / HTTP / WS。作为补偿，前端生产构建在本地跑通：30 个页面、48 个 JS/CSS 资源、`check-build-assets` 通过。
- **没有真人双浏览器对局**：仍是 agent 对 agent + 旁观视角。真人 UI 的联调依赖第 8 节部署后在线上做。
- **Contexto 长局不稳**：每座 60+ 猜的局，在八款游戏并发时出现过一次 `1102`（CPU 超限），单跑与短局（每座 10 猜）都通过。这是本轮唯一没能稳定复现的失败，需要上线后看 Workers 日志里 contexto 的实际 CPU 时间再决定是否要分摊猜词计算。顺带补上了两条规则终局的测试覆盖（第 3 节），这是本轮唯一新增的代码改动。
- **Codenames 大厅动作先入档**：选队动作记在 `game_started` 之前，所以 `events[0]` 不一定是开局事件，断言按"包含"写。

## 7.1 本轮跑过的门禁

| 门禁 | 结果 |
| --- | --- |
| `pnpm lint` | 8/8 通过；严格类型检查通过；`check:ai-spec` = 17 工具 / 8 catalog / 7 hosted Jev adapter，逐字一致 |
| `apps/workers` 类型 | `tsconfig.json` 与 `tsconfig.production.json` 均无错 |
| `ContextoRoom.test.ts` | 15 passed（含新增的 2 条终局用例，1.6s） |

## 8. 上生产

前置已核：迁移无待应用、四个 secret 齐、`ALLOWED_ORIGINS`/`FRONTEND_URL` 指向生产域。

```sh
pnpm db:migrate:prod     # 预期 No migrations to apply!
pnpm deploy:workers
pnpm deploy:web
```

- **顺序**：先 Worker 后 Pages。两者无强依赖（生产域本来就在 `ALLOWED_ORIGINS` 里），但先发后端能让新前端一上线就配到新 API。
- **窗口**：`SELECT count(*) FROM active_rooms` 为 0 时发；否则按第 5 节，进行中的玩家会白掉一手。
- **回滚**：Worker 用 `wrangler rollback` 回 `ff80ec0b`（2026-10-28T11:08Z）；Pages 在控制台把上一次 production 部署重新发布（当前是 `b869f3a`）。本轮**没有 schema 变更**，不需要回滚数据。
- **发布跨度**：线上 Worker 停在 10-28，前端停在 `b869f3a`（10-30）。这次一起带上 i18n 词表、八款游戏的插件化实现、以及今天的三处修复。

## 9. 复现命令

```sh
cd apps/workers

# 归档总览
npx wrangler d1 execute llmgames-online-db-staging --config wrangler-staging.json --remote \
  --command "SELECT game_type, end_reason, count(*) n FROM game_logs GROUP BY 1,2"

# 取一个归档抽查
npx wrangler r2 object get \
  "llmgames-online-game-logs-staging/game-logs/v1/<gameId>.json.gz" \
  --file /tmp/<gameId>.json --remote

# 生产部署窗口检查
npx wrangler d1 execute llmgames-online-db --config wrangler-prod.json --remote \
  --command "SELECT count(*) AS live FROM active_rooms"
```
