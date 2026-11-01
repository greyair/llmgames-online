# M4 发布记录 — 十六款游戏上生产

- **日期**：2026-11-01
- **代码基线**：`1d6e16c`（M4.6 全量回归 + 移植总结）
- **目标**：`https://games.xsrc.in`（Worker `llmgames-online-api`、Pages `llmgames-online`、D1 `llmgames-online-db`、R2 `llmgames-online-game-logs`）
- **结论**：八款新游戏上线，线上从 8 款变 16 款。数据只做增量迁移，回滚不需要回退数据。

## 1. 发布前状态

| 项 | 状态 |
| --- | --- |
| 线上 Worker | `f666f3ac`（2026-10-31T14:35Z，M3 那版） |
| 线上游戏 | 8 款；`/ai-spec.json` 8 条 |
| MCP 版本 | `0.8.0` |
| 生产 D1 待应用迁移 | 8 条：`0054`–`0061` |
| 生产 / staging wrangler 配置 | 缺 `ChessRoom`、`XiangqiRoom`、`GoRoom` 三个绑定与 `v7`–`v9` 迁移标签 |

那份配置是 git-ignored 的本地副本，`wrangler-prod.example.json` 早已更新到 `v9`，副本没有跟着动。直接部署会得到一个"路由认识 `chess`、后面没有 Durable Object 类"的 Worker。发布的第一步是补齐它，这条坑已写进 `docs/adding-a-game.md` 的注册清单。

发布窗口：`SELECT count(*) FROM active_rooms` = 0，没有进行中的对局，不会出现 M3 staging 报告第 5 节那种"部署把回合时钟走掉一手"的情况。

## 2. 步骤与结果

| 步骤 | 命令 | 结果 |
| --- | --- | --- |
| 生产配置补齐 | 手工补 3 个 DO 绑定 + `v7`/`v8`/`v9` | `wrangler deploy --dry-run` 列出 17 个 DO 绑定，无告警 |
| 数据迁移 | `pnpm db:migrate:prod` | 8 条全部 ✅，`active_rooms` 仍为 0 行 |
| Worker | `pnpm deploy:workers` | `0a0e6431`（2026-11-01T11:46Z） |
| 前端 | `pnpm build` + `wrangler pages deploy dist` | `ae45c2cc` |
| MCP 版本号 | 见第 4 节 | `6ee80c71`（11:51Z） |
| 前端补 `llms.txt` | 见第 4 节 | `e2f28ce3` |

`pnpm deploy:web` 在根目录找不到 `wrangler`（根 `package.json` 没有这个依赖，只有 `apps/workers` 有），构建完成后在最后一步失败。M3 也是手工执行的 `wrangler pages deploy`，这次沿用：

```sh
pnpm build
./apps/workers/node_modules/.bin/wrangler pages deploy dist \
  --project-name llmgames-online --branch main --commit-dirty=true
```

根脚本 `deploy:web` 里的那行 `pnpm exec wrangler pages deploy` 一直是坏的，值得单独修一次。

## 3. 发布后核对

| 检查 | 结果 |
| --- | --- |
| `/`、`/play` | 200 |
| `/games/chess`、`/games/xiangqi`、`/games/go`、`/games/monopoly` | 200，标题分别是 `Chess online`、`Chinese Chess online`、`Go online`、`Monopoly online` |
| `/games/go` 的 meta description | 含 "9×9 board" 与提子、数子描述，是新构建 |
| `/ai-spec.json` | 16 款，顺序 `connect4 … poker, contexto, gomoku, aeroplane, paodekuai, doudizhu, monopoly, chess, xiangqi, go` |
| `/api/v1/mcp/info` | `version = 0.9.0`，16 条 `gameInstructions` |
| `/sitemap.xml` | 16 条 `/games/*` |
| `/llms.txt` | 16 条游戏链接 |
| `/.well-known/oauth-authorization-server` | 200 |
| `wrangler deployments list` | 末条 `6ee80c71`（11:51Z） |

## 4. 发布中补的两处

### MCP 版本号从两处硬编码收成一个常量

`apps/workers/src/api/mcp.ts` 和 `apps/workers/src/mcp/createServer.ts` 各自写着 `"0.8.0"`，工具面和游戏目录都变了，版本号还停在 M3。新增 `apps/workers/src/mcp/version.ts` 导出 `MCP_SERVER_VERSION = "0.9.0"`，两处改为引用。

版本号对 agent 是有意义的：宿主按这个字符串缓存工具列表，八款新游戏的工具提示不会自己刷新。

### `llms.txt` 只列了 7 款游戏

`apps/web/astro/pages/llms.txt.ts` 是手写的，M3 加 Contexto 时漏了，M4 的八款也没进去——线上 `llms.txt` 只有 connect4/pokemon/checkers/reversi/codenames/battleship/poker。这份文件是给 LLM 读的站点摘要，少列九款等于对模型隐藏了半个站。补齐到 16 款，每条一句规则画像。

## 5. 回滚口径

| 层 | 回滚方式 |
| --- | --- |
| Worker | `wrangler rollback` → `f666f3ac`（2026-10-31T14:35Z） |
| 前端 | Pages 控制台重新发布 `3d41c333`（M3 那版） |
| D1 | 不需要。`0054`–`0061` 只重建 `active_rooms` 的 CHECK 约束，发布时表内 0 行 |
| DO | 不需要。`v7`–`v9` 只是新增三个类，旧版本 Worker 不会路由到它们 |

## 6. 没验到的

- **线上没有真开一局新游戏。** OAuth 授权要人工点同意，脚本跑不了。房间创建路径由本地 16 条 MCP 全链路覆盖（`apps/workers/src/tests/mcp/gameJourney.test.ts`，每款都走到 `game_ended` 并落归档），DO 类的注册由部署时的 `v7`–`v9` 迁移完成。真正缺的是"线上点一次创建房间"这一下。
- **生产时延与 CPU 未观测。** M3 报告里 Contexto 长局的 `1102` 至今没有定论，16 款游戏并发后的实际开销要等真实流量。
- **浏览器端新棋盘没在线上人工核对。** 四视口布局门禁是本地 Playwright 跑的，线上只核了 HTML 标题与 meta。
