# C2 实施报告：统一游戏规则选项

| 项 | 值 |
| --- | --- |
| 阶段 | C2 |
| 依赖 | C1（同一 `parseRoomCreationConfig` 入口） |
| 结论 | 已实现、已测试：Web 与 MCP 用同一份选项声明和同一个校验函数创建房间 |

## 1. 实际完成的功能

### 1.1 选项契约

新增 `packages/game-catalog/src/options.ts`（与 Web、Workers 共享）：

```ts
interface GameOptionChoice { value: string; labelKey: string }
interface GameOptionSpec {
  key: string; default: string;
  choices: readonly GameOptionChoice[]; labelKey: string;
}
GAME_OPTIONS: Partial<Record<GameTypeId, readonly GameOptionSpec[]>>
resolveGameOptions(gameType, raw): { ok: true; options } | { ok: false; error }
gameOptionsFor(gameType): readonly GameOptionSpec[]
gameOptionValue / gameOptionNumber   // 读值，含历史默认回退
```

只支持固定枚举。没有 JSON Schema、没有依赖选项、没有条件组合。

### 1.2 三款游戏

| 游戏 | key | 取值 | 默认 | 生效点 |
| --- | --- | --- | --- | --- |
| go | `size` | 9 / 13 / 19 | 9 | `createInitialState` → `boardSize`、`cells`、`playedAt`；`legal`、计分、Agent 决策、前端棋盘都读 `state.boardSize` |
| aeroplane | `takeoff` | 6 / 56 | 6 | `createInitialState` 与 `start()` 都读房间配置（**不在开局时重置为常量**） |
| monopoly | `rounds` | 20 / 40 / 0 | 0 | 新增 `state.roundLimit`；`nextTurn()` 达到上限即按资产结算（`richest()`，并列即平局） |

Go 的 `komi` 保持 7.5（与历史一致），未随棋盘尺寸变化——这一点在报告里明确，避免被误解为"19 路也用 9 路的贴目规则"。

### 1.3 调用链

```text
GAME_OPTIONS (game-catalog)
   ├── Web Lobby（Room 创建表单，默认值来自同一张表）
   └── MCP room_create（options 参数）
          ↓
   rooms.ts：创建前先校验（不合法直接 400，不占用房间码）
   MCP：创建前先校验（不合法直接报错，不 reserve 房间码）
          ↓
   POST /create { options } → parseRoomCreationConfig(body, 房间自己的 gameType)
          ↓
   GameRoomConfig.options（已填默认值）
          ↓
   plugin.createInitialState(config) + gameState.roomOptions
          ↓
   DO 持久化 → 开局 / 回放 / 重启恢复
```

关键点：`gameType` 由房间自己的 `gameRules().id` 决定（`roomGameType()`），**不读客户端传来的 `gameType`**，因此不能借别的游戏的选项词表。

### 1.4 兼容与约束

- 不传选项 → 全部填默认值（9 路 / 掷 6 / 无轮数上限），旧客户端行为不变。
- 传未声明的键 → 400 `"go has no option \"komi\""`。
- 传未声明的值 → 400 `"size must be one of 9, 13, 19"`。
- 对不声明选项的游戏传选项 → 400 `"connect4 does not accept rule options"`。
- 旧房间无 `roomOptions` → 插件经 `gameOptionValue` 回退历史默认值，不改写旧状态、不重算旧结果。
- 房间创建后选项不可改（没有 `set_option` 动作，只有 `roomOptions` 一处写入）。
- 数值型选项以字符串传输，服务端拒绝非字符串值（避免 `9` 与 `"9"` 两种表示混入）。

## 2. 代码变更

新增：

```text
packages/game-catalog/src/options.ts          187 行
apps/workers/src/tests/contracts/gameOptions.test.ts  110 行
apps/workers/src/tests/games/roomOptions.test.ts      290 行
apps/web/src/game-ui/gameOptions.ts                    36 行
apps/web/tests/game-ui/gameOptions.test.ts             48 行
```

修改：

| 文件 | 改动 |
| --- | --- |
| `packages/game-catalog/src/index.ts` | 导出选项契约；`listGameToolsCatalog` 增加 `gameOptions` 段 |
| `packages/game-catalog/src/agent-state.ts` | 投影字段表增加 `roundLimit` |
| `durable-objects/types.ts` | `GameRoomConfig.options`、`BaseGameState.roomOptions`、`MonopolyGameState.roundLimit` |
| `BaseGameRoom.ts` | `parseRoomCreationConfig(body, gameType)` 返回 `{ok,config}|{ok:false,error}`；`applyRoomOptions()`；`roomGameType()` |
| `api/rooms.ts` | create schema 增加 `options`；创建前 `resolveGameOptions`；转发解析后的映射 |
| `mcp/createServer.ts` | `room_create` 增加 `options` 参数与说明 |
| `games/go/plugin.ts` | 从选项取 `boardSize` |
| `games/aeroplane/plugin.ts` | 从选项取起飞点数，`start()` 不再覆盖 |
| `games/monopoly/plugin.ts` | `roundLimit` + 轮数结算 |
| `games/monopoly/agent.ts` | 决策态暴露 `roundLimit` / `rounds` |
| `web/Room.tsx` | 创建表单渲染选项组；`Choices` 支持字符串值与格式化标签 |
| `web/LobbySetup.tsx` | 大厅只读展示房间实际选项 |
| `web/domain/game-state.ts` | 视图契约增加 `roomOptions` / `roundLimit` |
| `web/services/gameSocket.ts` | `CreateRoomOptions.options` |
| `web/i18n/locales/*` | 12 条选项文案（中英成对） |

## 3. 新增接口与共享契约

```ts
// 共享（game-catalog）
GAME_OPTIONS / GameOptionSpec / GameOptionChoice / resolveGameOptions
gameOptionsFor / gameOptionValue / gameOptionNumber

// 创建请求（Web + MCP 通用）
POST /api/v1/rooms/create   { gameType, options?: Record<string,string>, ... }
MCP room_create              { controllerId, gameType, options?, ... }

// 房间状态 / 视图
BaseGameState.roomOptions?: Record<string, string>
ClientView.roomOptions?: Record<string, string>
ClientView.roundLimit?: number
list_game_tools().gameOptions: { [game]: [{ key, default, values }] }
```

## 4. 测试命令与结果

```bash
pnpm --filter @llmgames/workers exec vitest run src/tests/contracts/gameOptions.test.ts
# 12 passed
pnpm --filter @llmgames/workers exec vitest run src/tests/games/roomOptions.test.ts
# 17 passed
pnpm --filter @llmgames/web test        # 15 files / 575 passed（含 5 条选项文案用例）
pnpm --filter @llmgames/workers test    # 103 files / 915 passed, 2 skipped（C1 后 886 + 29）
pnpm lint                               # oxlint / eslint / CSS 令牌 / AI spec 全部通过
```

覆盖点：

| 需求 | 用例 |
| --- | --- |
| 默认值 | `creates a 9-line board by default`、`defaults to needing a six`、`defaults to no round limit`、`fills every declared key with its default` |
| 合法选项 | `creates a 13/19-line board on request`、`accepts a five when the room says 5 or 6`、`stores the requested limit` |
| 非法选项 | 三个 `refuses an undeclared …` + `refuses a board size the game does not offer` + 契约层 4 条 |
| Web/MCP 一致性 | 两条链路都调用 `resolveGameOptions`，契约用例即两端的共同语义 |
| 旧房间兼容 | `falls back to the declared default for an older room with no options` |
| 持久化 / 重启恢复 | `keeps the chosen size after the room restarts`（19 路，361 格） |
| 回放 | `roomOptions` 写入 `gameState`，`rewatchView` 默认继承；Go 的 `rewatchView` 只剥离 `history` |
| 规则确实生效 | `accepts a move on the extra lines of a 13-line board` 与 `rejects that same move on a 9-line board`；`lets a five launch a plane under the 5-or-6 rule`；`settles on assets when the last round ends` |
| 不改变旧语义 | `plays on with no limit set`（无上限时不结算） |

## 5. 可复现路径

1. 浏览器打开 `/go`，创建房间时选择「13 路」→ 开局后棋盘为 13×13（`state.boardSize === 13`）。
2. MCP：`room_create { gameType: "aeroplane", maxPlayers: 2, options: { takeoff: "56" } }` → `get_state.board…takeoff` 返回 `[5,6]`；掷出 5 点时 `legalActions` 含可起飞的飞机。
3. 浏览器打开 `/monopoly`，选择「20 轮」→ 大厅设置区显示「对局长度 20 轮」，`state.roundLimit === 20`。
4. 反例：`room_create { gameType: "go", options: { size: "11" } }` → 报错 `size must be one of 9, 13, 19`，不会创建房间。

## 6. 性能影响（实测）

| 指标 | C1 后 | C2 后 | 差 |
| --- | --- | --- | --- |
| Worker 上传体积 | 17671.75 KiB | 17678.67 KiB | **+6.92 KiB** |
| Worker gzip | 4201.43 KiB | 4204.11 KiB | **+2.68 KiB** |

- 创建路径多一次纯函数校验（无 I/O）。
- 19 路围棋的状态体积：`cells` 361 + `playedAt` 361（对比 9 路 81+81），单帧约增 1.1 KB JSON；回放帧同理，仍远低于 `MAX_REWATCH_FRAME_BYTES`（256 KB）。
- 大富翁多一个 `roundLimit` 数值字段。

## 7. 旧版本兼容

| 项 | 处理 |
| --- | --- |
| 旧浏览器客户端 | 不发送 `options`；服务端填默认值，行为与之前完全一致 |
| 旧 MCP 客户端 | `options` 是可选参数，缺省即默认 |
| 旧房间状态 | 无 `roomOptions`；插件回退默认值，不写回、不重算 |
| 数据库 | 无 D1 迁移；选项只存在 DO 的 `gameState` |
| 系列赛 | `/series/setup` 也走同一个解析入口；系列配置目前不携带选项，因此系列房使用默认值（与之前一致） |
| 回放 | `roomOptions` 随 `gameState` 进入回放帧；旧回放无该字段，读取方全部按可选处理 |

## 8. 已知问题与未完成事项

**已实现、已测试**：第 1 节全部内容。

**已实现、未在本环境演练**：

- "9 / 13 / 19 路三局完整对局"与"两种起飞规则对局"的真人/Agent 联调。测试覆盖了创建、开局、单步合法性、规则分支与恢复；**完整连到终局**只在斗地主式短局上未做，围棋与大富翁的长局需要外部 Agent 才能跑完。可复现步骤见第 5 节。

**范围限制（设计如此）**：

- 大富翁 `rounds` 的轮数按 `turns / 存活人数` 计算，玩家中途破产会让轮数跳变——这是既有 `rounds` 的定义，本次没有改。轮数上限因此是"约 N 轮"，不是精确到每一步。
- 围棋的 `komi` 不随棋盘尺寸变化（固定 7.5）。
- 系列赛不携带选项（结构未改），因此系列内的围棋固定 9 路、大富翁固定无轮数上限。

**暂缓**：

- 任意 JSON Schema、依赖/条件选项、插件自定义选项 UI。
- 房间创建后修改规则（需要新的房间生命周期语义，不在本次范围）。

## 9. 后续可选增强

1. 系列赛继承首局选项（需要在 `seriesConfigSchema` 增加字段并回放校验）。
2. 按棋盘尺寸调整贴目（19 路 6.5、13 路 7.5）。
3. 在 `List_game_tools` 之外，让 `get_tool_schema` 也返回该游戏的选项说明。
