# 宝可梦界面中文化

- **日期**：2026-11-02
- **范围**：第一世代（`gen1randombattle`）的宝可梦名、招式名、招式说明、属性、分类、战斗日志与回放播报

## 为什么不在服务端翻译

服务端投影里的 `pokemon.name`、`move.name`、`shortDesc`、`type` 都是 Pokémon Showdown 的英文字符串，而同一份投影也发给 MCP 的 Agent（`get_state` / `wait_for_turn`）。在服务端翻译会同时改掉 Agent 读到的标识，让工具说明、日志和模型决策对不上。

所以协议层保持英文，**只在浏览器渲染时按语言取值**：中文界面显示官方译名，英文界面原样显示。`pokemonZh.ts` 里没有副作用，服务端代码一行未动。

## 词条来自哪里

| 类别 | 数量 | 口径 |
| --- | --- | --- |
| 宝可梦 | 151 | 任天堂／宝可梦官方简体中文名（巴大蝶、大比鸟、魔墙人偶、多边兽、钻角犀兽…） |
| 招式 | 165 | 官方招式名（十万伏特、双倍奉还、地狱滚动、地球上投、自爆…） |
| 招式说明 | 165 | 按 `@pkmn/sim` 第一世代机制撰写，与 `shortDesc` 对齐 |
| 属性 | 16 | 一般／火／水／电／草／冰／格斗／毒／地面／飞行／超能力／虫／岩石／幽灵／龙／无属性 |
| 分类 | 3 | 物理／特殊／变化 |

两处刻意的例外：

- **聚气**（Focus Energy）在第一世代实际会*降低*会心率，官方文本只写「提高」。说明里补了「（第一世代中效果相反。）」，因为模拟器实现的是一世代的 bug。
- **Bide** 在模拟器里属性是 `???`，译作「无属性」，而不是硬套「一般」。

## 渲染层如何取词

`apps/web/src/game-ui/pokemon/pokemonZh.ts`：

```ts
pokemonName("Mr. Mime", "zh-CN") // 魔墙人偶
moveName("thunderbolt", "zh-CN") // 十万伏特（id 与英文名共用一张表）
moveText("Thunderbolt", "zh-CN") // 用强力电流攻击。有时会让对手麻痹。
typeName("Psychic", "zh-CN")     // 超能力
damageLabel("Half the target’s current HP", t) // 对手当前体力的一半
```

协议里的名字带空格、句点、弯引号与性别后缀（`Nidoran-F`、`Farfetch’d`），字典按「小写字母数字」归一化后建索引，因此英文名与 id 都能查到。查不到时退回原文——宁可显示英文，也不显示空白。

覆盖的渲染点：

- `MonsterView`（场上宝可梦、血量、状态贴纸、基础能力）
- `BattleControls`（招式按钮、替换列表）
- `MoveButton`（招式名、属性／分类、说明、固定伤害）
- `PokemonDetails` / `BattleInspect`（详情面板、已公开招式）
- `SpectatorTeams`（观战席位）
- `BattleLog`（日志里的人和招式）
- `Pokemon.tsx` + `features/pokemon/playback.ts`（回放播报：招式、上场、倒下、能力变化、会心一击）

回放文案原本是写死的英文句子，现在通过 `CueText` 注入，动画时长与语言无关。

## 回归测试

| 测试 | 保证什么 |
| --- | --- |
| `apps/workers/src/tests/games/pokemon/chineseNames.test.ts` | 拿 `@pkmn/sim` 的第一世代图鉴逐条对表：151 只、165 个招式，缺一条就红；每条说明非空且含中文 |
| `apps/web/tests/game-ui/pokemonZh.test.ts` | 官方译名（含 Nidoran／Mr. Mime／Farfetch’d 这类难例）、id 与英文名双路径、英文界面原样返回、未知词条退回、日志与播报的中文化 |

新增宝可梦或招式时，模拟器数据变了而词表没跟上，第一条测试会直接失败——这是唯一可靠的提醒，因为漏译不会报错，只会在中文对局里冒出一个英文名。

## 没做的事

- 不翻译 MCP 的投影与工具说明（见上）。
- 不翻译 `format` 标识（`gen1randombattle`）、道具与特性（第一世代随机对战不涉及）。
- 设计预览页（`/design-preview/*`）自带的英文壳层文案属于开发脚手架，不参与生产构建。
