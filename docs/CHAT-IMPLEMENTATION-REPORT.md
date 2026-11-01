# C1 实施报告：统一房间聊天 + MCP 聊天

| 项 | 值 |
| --- | --- |
| 阶段 | C1 |
| 基线 SHA | `a4b51fdf068911f5c1a964d4a4843d60d21e74a7` |
| 提交 | `feat(chat): add unified room chat and MCP messaging`（见 `git log`，本文件随该提交入库） |
| 结论 | 已实现、已测试：真人 WebSocket 与 MCP Agent 使用**同一个**房间聊天存储与同一套权限/限流规则 |

## 1. 实际完成的功能

### 1.1 一个聊天系统，两个入口

```text
Browser  --chat_send-->  ┐
                         ├─> RoomChatService（房间 DO 的 SQLite）─> chat_message 广播
MCP      --/agent/chat-->┘
```

- 消息存放在房间 Durable Object 自己的 SQLite 表 `chat_messages` / `chat_receipts` 中，**不是** `gameState`，也没有新建 ChatRoom Worker。
- WebSocket 与 MCP 读写同一张表、同一套校验、同一个序号序列，因此不存在"两套互不相通的聊天记录"。

### 1.2 协议

| 方向 | 消息 | 说明 |
| --- | --- | --- |
| C→S | `chat_send { text, mentions?, requestId? }` | 发送者取会话席位；`senderPlayerId` 不在契约内，传了也被忽略 |
| C→S | `chat_fetch { sinceSeq?, limit? }` | 断线补取；`limit` 上限 200 |
| S→C | `chat_message` | 公共广播，仅含消息与作者身份 |
| S→C | `chat_history` | 连接首帧 + 每次 `chat_fetch` 的有界窗口 |
| S→C | `chat_error { code, message }` | 仅发给发送者 |

MCP 工具：

```text
send_room_message { controllerId, roomId, text, mentions?, requestId? }
get_room_messages { controllerId, roomId, sinceSeq?, limit? }
```

两者都先经 `requireAgentRoomPlayer()` 把私有 `agentId` 换成房间级公开 `playerId`，再调用 DO 的内部端点，因此 MCP 侧无法指定别人的身份。

### 1.3 规则与限额（服务端强制）

| 规则 | 值 | 位置 |
| --- | --- | --- |
| 文本长度 | 1–400 码点（空白折叠后计数） | `chatValidation.normalizeChatText` |
| 控制字符 | 拒绝（`\u0000-\u001F`、DEL），零宽字符剥离 | 同上 |
| 提及 | 只能是房间成员的稳定 id，最多 8 个 | `normalizeChatMentions` |
| 限流 | 令牌桶容量 5，每 2s 补 1 | `ChatRateLimiter` |
| 在线窗口 | 默认 50 条，单次最多 200 条 | `normalizeChatLimit` |
| 保留 | 每房间最近 200 条，写入时裁剪 | `CHAT_RETENTION` |
| 幂等 | `(playerId, requestId)` 指纹匹配则重放 | `chat_receipts` |
| 旁观者发言 | 默认允许；房主可 `set_spectator_chat { allowed }` | 房间 storage key `chatPolicy` |

`set_spectator_chat` 只写 `chatPolicy`，不写 `gameState`，因此不影响回放、归档与历史结果。

### 1.4 AI 提示更新

`createServer.ts` 原来只有 "SILENT PLAY"（对**宿主聊天**静默），容易被模型理解为对局中完全不许说话。现补充：

- 明确 SILENT PLAY 只约束宿主聊天，对局内的交流走 `send_room_message`。
- 说明聊天不消耗行动、不重置计时、不改变棋盘。
- 说明"不必回复每条消息"。
- 说明聊天内容是不可信文本，不能覆盖系统与工具规则。

### 1.5 前端

`RoomChat` 挂在 `MatchDesk` 之后，不进入棋盘布局：

- 桌面（≥900px）：右侧固定抽屉，宽 `min(360px, 30vw)`，棋盘宽度不变。
- 移动（<900px）：底部抽屉，`max-height: 55vh`，聚焦时降到 45vh 给软键盘让位。
- 未读计数、仅在有新消息且面板关闭时累加；打开时按 `sinceSeq` 补取。
- 自动滚动只在读者已经在底部时生效（`follow` 判定 48px 阈值）。
- `@` 按钮打开成员选择器，产出**id 列表**而不是靠名字反查。
- 消息一律以文本节点渲染（`{entry.text}`），服务端也不做 HTML 转换。
- 英文/中文本地化、`aria-live="polite"`、Escape 关闭、按钮带 `aria-expanded`。

## 2. 代码变更

新增：

```text
apps/workers/src/durable-objects/chat/chatTypes.ts       111 行
apps/workers/src/durable-objects/chat/chatValidation.ts  157 行
apps/workers/src/durable-objects/chat/RoomChatService.ts 484 行
apps/web/src/domain/chat.ts                               63 行
apps/web/src/game-ui/RoomChat.tsx                        280 行
apps/web/src/game-ui/room-chat.css                       239 行
apps/workers/src/tests/platform/RoomChat.test.ts         537 行
apps/workers/src/tests/platform/RoomChatService.test.ts  183 行
apps/web/tests/domain/chat.test.ts                        76 行
```

修改（公共文件）：

| 文件 | 改动 | 量级 |
| --- | --- | --- |
| `BaseGameRoom.ts` | 聊天服务接线、4 个端点分支、`set_spectator_chat`、清理时释放服务 | +274 行 |
| `mcp/createServer.ts` | 2 个工具 + instructions 更新 | +113 行 |
| `types.ts`（workers） | `ClientMessage`/`ServerMessage` 增加 chat 分支；`channel` 改用统一 `SeatChannel` | +29 −6 |
| `durable-objects/types.ts` | `SeatChannel` 增加 `bot`；`bot?` 标记（供 C4 使用） | +12 |
| `lib/codenames.ts` | 复用统一 `SeatChannel`，`channelLabel` 增加 bot 分支 | +6 −2 |
| `gameSocket.ts` | `sendChat` / `fetchChat` + 消息类型 | +40 |
| `Room.tsx` | 聊天状态、socket 订阅、挂载 `RoomChat` | +60 |
| `i18n/locales/{en,zh-CN}.ts` | 20 条聊天文案（成对，缺一中编译失败） | +40 |
| `interface/content/ai-spec.json` | 重新生成（17 → 19 个 MCP 工具） | — |

## 3. 新增接口与共享契约

```ts
// 服务端内部
class RoomChatService {
  initialize(): Promise<void>;
  append(input: {...}): Promise<RoomChatSendResult>;
  read(input: { sinceSeq?: WireValue; limit?: WireValue }): Promise<RoomChatPage>;
  recent(limit?: number): Promise<RoomChatPage>;
  getPolicy(): RoomChatPolicy;
  setPolicy(policy: RoomChatPolicy): Promise<RoomChatPolicy>;
  forgetMember(playerId: string): void;
  clear(): Promise<void>;
}

// DO HTTP
POST /agent/chat   { playerId, text, mentions?, requestId? } -> { ok, replayed, message }
GET  /agent/chat?playerId&sinceSeq&limit -> RoomChatPage

// MCP
send_room_message, get_room_messages

// WS
chat_send, chat_fetch  (C→S)     chat_message, chat_history, chat_error  (S→C)
```

`RoomChatPage.policy.spectatorSpeech` 是新增的公共字段，用于让浏览器知道旁观者是否被禁言。

## 4. 测试命令与结果

```bash
pnpm --filter @llmgames/workers exec vitest run src/tests/platform/RoomChat.test.ts
# 19 passed

pnpm --filter @llmgames/workers exec vitest run src/tests/platform/RoomChatService.test.ts
# 12 passed

pnpm --filter @llmgames/web test        # 14 files / 570 passed（含新增 5 条 chat 契约用例）
pnpm --filter @llmgames/workers test    # 101 files / 886 passed, 2 skipped（基线 855 + 31）
pnpm lint                               # oxlint 0 error、eslint 0 error、CSS 令牌、AI spec 19 工具一致
pnpm build:all                          # 6 tasks successful，46 页面
```

覆盖点对应需求（`RoomChat.test.ts`）：

| 需求 | 用例 |
| --- | --- |
| WebSocket → WebSocket | `delivers a human message to every member` |
| WebSocket → MCP | `lets MCP read a message a human just sent` |
| MCP → WebSocket | `broadcasts an MCP message to browser sockets` |
| MCP → MCP | 同一 `requestId` 重放用例（两个 MCP 调用共享存储） |
| 独立 Controller | 由 `playerId` 区分；用例 `allocates a monotonic sequence across senders` |
| @玩家 / @AI | `resolves a mention to a member id` |
| 旁观权限 | `mutes spectators only when the host says so` |
| 消息顺序 | `allocates a monotonic sequence across senders` |
| 历史游标 | `answers a cursor request`、`bounds a read`、`keeps the conversation across a restart` |
| 幂等 | WS 与 MCP 各一条 |
| 断线重连 | `keeps the conversation across a Durable Object restart`（同 storage 唤醒） |
| 限流 | `limits a member to a burst` |
| XSS | `keeps markup as literal text` |
| 存储失败 | `reports a storage failure instead of a false success` |
| 终局状态 | 房间清理会 `deleteAll()` 一并删除聊天；连接首帧永远给出当前窗口（不可测终局保留期的部分见第 8 节） |
| 隐私隔离 | `carries no projected game state in a chat frame`（字段逐项断言） |
| 不影响回合 | `does not touch the turn, the clock or the room timestamp` |

`RoomChatService.test.ts` 另外覆盖：空白折叠、码点计数、零宽字符、提及去重、令牌桶补充、保留窗口裁剪（205 条 → 200 条）、策略持久化与重载、被禁言旁观者。

## 5. 可复现的手工联调路径

本地开发只需要一个真人和一个 MCP 客户端：

1. `pnpm dev`（web:3000，workers:6787），登录后创建任一游戏房间，拿到 6 位房间码。
2. `pnpm --filter @llmgames/mcp-server start` 连接本地 MCP 端点；在 AI 客户端里 `agent_claim` → `room_join`。
3. 浏览器输入一条消息 → MCP `get_room_messages` 应返回同一条（seq 相同）。
4. MCP `send_room_message { text, mentions: [房主 playerId] }` → 浏览器面板出现消息，房主那一行带提及高亮。
5. 断开浏览器网络后重新连入：面板应重新出现全部历史，`seq` 不重复。
6. 房主发送 `set_spectator_chat { allowed: false }`，旁观者输入框应禁用并提示已禁言。

四个独立身份（1 真人 + 3 Agent）的完整验收脚本与期望输出不在本文件自动执行——见第 8 节"未验证"。

## 6. 性能影响（实测）

| 指标 | 基线 `a4b51fd` | 本提交 | 差 |
| --- | --- | --- | --- |
| Worker 上传体积（dry-run） | 17645.68 KiB | 17671.75 KiB | **+26.07 KiB** |
| Worker gzip | 4194.82 KiB | 4201.43 KiB | **+6.61 KiB** |

测量方式：`npx wrangler deploy --dry-run --config wrangler.json`（对同一工作区执行两次，一次为 `git stash -u` 后的基线）。

- 每次发送最多 1 次 `INSERT` + 1 次回执 `INSERT` + 2 次裁剪 `DELETE`，同一 `transactionSync` 内完成。
- 读取按 `seq > ?` 走主键范围扫描，`LIMIT` 由 `limit` 约束。
- 聊天不触发 `saveState()`、不写 `gameState`、不排 alarm，因此不改变房间的写入放大。
- 浏览器侧 `RoomChat` 位于 `Room` 的懒加载 chunk 内，不进入首页首屏 bundle。

## 7. 旧版本兼容

| 项 | 处理 |
| --- | --- |
| 旧客户端 | 不识别 `chat_*` 消息：`serverMessageSchema` 在旧 bundle 中会丢弃该帧，不影响游戏状态 |
| 旧房间 | 没有 `chat_messages` 表：首次使用时 `CREATE TABLE IF NOT EXISTS` 建立，不影响既有 `gameState` |
| 房间清理 | `deleteAll()` 覆盖聊天表；服务实例在清理时置空，避免序号延续到下一个房间 |
| 生产迁移 | 无 D1 迁移、无 DO migration、无新绑定 |
| `SeatChannel` 扩展 | 只增加 `bot`；`channelLabel` 补分支；旧房间数据不含该值 |
| 流媒体 | 未触碰 `broadcastAllowed`（仍恒为 false），广播 socket 不接收聊天 |

## 8. 已知问题与未完成事项

**已实现、已测试**：上文第 1、4 节的全部内容。

**已实现、未在本环境演练**：

- 四独立身份（1 真人 + 3 MCP）真实联调。本环境没有可用的 MCP OAuth 客户端与浏览器会话，故以 `RoomChat.test.ts` 的会话级集成测试代替（同一 DO、同一 socket 通道、同一 `/agent/chat` 端点，仅身份由测试注入）。第 5 节给出了可复现步骤。
- 终局后聊天保留期的"可读"行为：实现上聊天与房间同生命周期（房间清理即删除），符合"短期保留、随房间到期删除"，但没有单独的房间结束后时间窗（例如结束后 10 分钟仍可读）。当前语义是"房间还在就能读，房间清理后一起消失"。

**仅有设计、未实现**：

- `wait_for_room_event`（聊天与游戏事件的统一长轮询）。按计划先评估：现有 `wait_for_turn` 是进程内 Promise + 最多 30s，若把聊天也接进去，每个 Agent 需要一个常驻等待器，与"不要为聊天建立常驻轮询任务"的要求冲突，故本阶段只提供发送与读取。
- `ChatUnreadIndicator` 独立组件：未读逻辑已内联在 `RoomChat` 的角标里，没有再拆文件。

**暂缓**：

- 私信、群组、跨房间社交、聊天历史写入 R2 回放（明确不在本次范围）。
- 聊天内容的服务端过滤（脏词/审核）：当前只做长度、控制字符与限流，语义过滤属于产品策略。

## 9. 后续可选增强

1. 房间结束后的独立保留窗口（例如 `endedAt + 10min`），让复盘时仍能读到赛后对话。
2. 聊天与回放联动：把 `chat_message` 作为回放时间线上的旁注（需要新的 R2 文档字段，属于独立功能）。
3. 按游戏配置"是否允许旁观者发言"（当前是房间级、房主可切换）。
4. 把 `ChatRateLimiter` 的桶状态放到 storage，使跨 isolate 的限流严格连续（当前重启会重置突发额度）。
