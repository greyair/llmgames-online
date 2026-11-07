# MCP 个人访问令牌（PAT v1）

- **日期**：2026-11-08
- **范围**：`/api/v1/mcp` 的第二种认证方式
- **不变**：OAuth 2.1 仍是默认；MCP 工具、GamePlugin、Durable Object、`agent_claim` 全部不动

## 为什么需要

OAuth 要求有浏览器。跑在 Linux 服务器、Codex CLI、自建 Runner 里的 Agent 没有——它需要一个能直接放进请求头的凭据。

PAT 解决的就是这一件事：**证明"我是哪个用户"，仅此而已**。它不是会话、不是身份、也不是 Agent 的替代品。

## 令牌长什么样

```
llgm_pat_v1_<16 位十六进制 id>.<43 位 base64url secret>
```

- `id` 是公开的一半，用于一次索引定位，避免全表扫描；
- `secret` 32 字节 CSPRNG，只在创建时返回一次；
- 数据库只存 `HMAC-SHA256(ENCRYPTION_SECRET, "pat:<id>:<secret>")`，**表泄露也无法重放**；
- 校验用常量时间比较，`id`/`secret` 任一不对都返回同一个 401。

## 使用

```http
POST /api/v1/mcp HTTP/1.1
Host: games.xsrc.in
Authorization: Bearer llgm_pat_v1_xxxxxxxxxxxxxxxx.yyyy...
Content-Type: application/json
Accept: application/json, text/event-stream
```

MCP 规范要求 Bearer 放在 `Authorization` 头，**不要**放进 URL 查询参数（会进日志、进历史）。

客户端只支持自动 OAuth、不能手动配置头的，继续走 OAuth；PAT 不替代授权流程。

## 能做什么，不能做什么

| 能力 | OAuth | PAT |
| --- | --- | --- |
| 调用 `/api/v1/mcp`（全部 19 个工具） | ✅ | ✅ |
| `agent_claim` → controller → 游戏席位 | ✅ | ✅ |
| 读取/修改账号资料 | ✅ | ❌ |
| 管理 TypeSafe 凭据、Webhook | ✅ | ❌ |
| 创建/撤销令牌 | ✅ | ❌ |
| 作为网页会话登录 | ✅ | ❌ |

最后三行是刻意设计：**一个 PAT 不能给自己续命**。否则一次泄露就能无限繁殖，撤销形同虚设。

## 与 Agent Controller 的关系

```
用户账号
 ├─ OAuth 客户端 A ──agent_claim──▶ Controller A ──▶ 席位
 ├─ PAT「DSH 服务器」──agent_claim──▶ Controller B ──▶ 席位
 └─ PAT「Codex」──────agent_claim──▶ Controller C ──▶ 席位
```

令牌标识**账号**，`controllerId` 标识**任务**。两者不合并：

- 同一个 PAT 开两个并发任务，仍要 `agent_claim` 两次，拿到两个 controller；
- 三个 PAT 属于同一账号，也互不共享 controller；
- 撤销 PAT 后，下一次 MCP 请求立即 401——即使旧 controller 还没到期。

PAT 的名字会成为席位上的环境标签（`pat:<名称>`），所以花名册里看到的是「DSH 服务器」而不是笼统的 MCP Agent。

## 管理接口

全部要求**浏览器会话**，且写操作要求近期重新登录 + 允许的 Origin：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/v1/auth/users/me/mcp-tokens` | 自己的令牌列表（无 secret） |
| POST | `/api/v1/auth/users/me/mcp-tokens` | 创建，返回明文一次 |
| DELETE | `/api/v1/auth/users/me/mcp-tokens/:id` | 撤销（写 `revoked_at`） |

限制：

- 每账号**最多 10 个**有效令牌（撤销或过期的释放名额）；
- 有效期 1–365 天，默认 90 天；
- 名称 1–40 字符，允许字母/数字/空格/`. _ - / ()`；
- 创建 20 次/小时、撤销 40 次/小时（按用户计）；
- `last_used_at` 最多每分钟写一次，避免每次调用都写库。

## 数据结构

```sql
CREATE TABLE mcp_personal_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
```

撤销不删行：保留审计线索，`revoked_at IS NULL AND expires_at > now` 才算有效。

## 验证边界

PAT 的校验挂在 **MCP 路由上**（`api/mcp.ts`），不是全局 `sessionMiddleware`。这是关键：

- 全局中间件加 PAT 会把整个用户 API 暴露给令牌；
- 路由级中间件只让 `/api/v1/mcp` 认这个前缀，其余接口即使带着令牌也走匿名分支。

`apps/workers/src/tests/auth/mcpPersonalTokens.test.ts` 里 10 条用例把这条边界钉住了：令牌能调 MCP、不能调 `/users/me/agents`、不能创建/撤销令牌、过期/撤销/改密即失效、跨账号撤销返回 404、上限生效、畸形令牌不会回落到 OAuth 握手。

## 环境隔离

PAT 存在各自环境的 D1 里：production 的令牌在 staging 不存在，反之亦然。不要跨环境复制。

## 刻意没做

- **细粒度 scope**：当前 OAuth 也只有 `mcp` 一个 scope，先保持一致；等出现只读 Agent、受限机器人再设计工具级校验。
- **令牌轮换 API**：重建一个、撤销旧的即可，不提供"恢复原密钥"。
- **服务端缓存**：每次请求一次索引查询 + 一次 HMAC，成本可接受；缓存会带来撤销延迟。
