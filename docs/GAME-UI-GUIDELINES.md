# 游戏 UI 接入规范（Mono Dither）

新增游戏的视觉必须像同一个产品。这份文档只写**怎么做**，不重复 `docs/design-tokens.md` 里已有的令牌说明。

## 1. 分工：谁负责什么

| 界面部分 | 归属 | 新游戏是否要写 |
| --- | --- | --- |
| 房间外壳、顶栏、时钟、玩家卡片、观战条 | `MatchDesk` / `Room` / `useMatchClock` | 不写 |
| 大厅、席位分配、邀请 | `LobbySetup` | 不写 |
| 结果面板、再来一局、找下一局 | `MatchResult` | 不写 |
| 回放控制、终局棋盘容器 | `FinalState` | 只在需要时登记 |
| 棋盘 / 手牌 / 地图 / 操作控件 | 游戏自己的组件 | **写** |
| 目录图标（10×10）、场景插画（96×64） | `GameMark` / `GameScene` | **写** |
| 文案（名称、规则、提示、无障碍名） | i18n 词表 + `gameRules` | **写** |

判断标准：**如果一段 UI 在第二个游戏里也要出现，它就不该写在新游戏里。**

## 2. 必须触碰的文件

```text
apps/web/src/game-ui/<Game>.tsx            棋盘组件（+ 同名 .css 只放棋盘材质）
apps/web/src/game-ui/boardRegistry.ts      BOARDS 表加一行（Record<GameTypeId> 编译期强制）
apps/web/src/interface/catalog.ts          LIBRARY_ORDER 决定目录顺序
apps/web/src/interface/gameRules.ts        规则 5 条 + roomGuides 一条
apps/web/src/interface/gameRules.zh-CN.ts  同步中文（Record<keyof typeof rules> 强制）
apps/web/src/interface/GameMark.tsx        10×10 像素字模
apps/web/src/interface/GameScene.tsx       96×64 场景插画
apps/web/src/design/tokens.css             新调色板 --palette-<game>-*
apps/web/src/design/games.css              [data-game="<id>"] 三个色槽
apps/web/src/i18n/locales/{en,zh-CN}.ts    game.<id>.* 五键 + board.<id>Board
apps/web/src/dev/preview{pCatalog,Scenarios,Fixtures}  预览场景（e2e 依赖）
apps/web/e2e/scenario-layout.spec.ts       四视口布局用例
```

漏掉任何一项的后果都是可预测的：`Record<GameTypeId, …>` 编译失败、目录缺图、e2e 找不到棋盘、中文缺键编译失败。

## 3. 棋盘组件的契约

```ts
interface GameBoardProps {
  state: ClientView;                       // 服务端投影
  send: (name: string, data: WireValue) => void;
}
```

必须做到：

1. **只读渲染**：状态从 `state` 读，绝不自行推导胜负。
2. **权限来自投影**：`state.you.isYourTurn && legalActions.includes(...) && !isSpectator && !replayReadOnly` 才允许操作。
3. **观战/回放只读**：`state.you?.isSpectator` 或 `state.replayReadOnly` 时禁用点击，仍要能显示终局棋盘。
4. **移动端**：棋盘用 `container-type: size` + `min(100cqw, 100cqh, …)` 自适应，禁止横向溢出；点击目标不小于 24px（15 路棋盘在 390px 宽时单格约 22px，用透明命中圈放大）。
5. **无障碍**：`<svg role="img" aria-label={t("board.<id>Board")}>`；交互点带 `data-row`/`data-col` 便于测试。
6. **反馈**：落子/翻牌用现有 `play()` 音效，音高与力度和同族游戏一致；终局交给 `MatchResult`，不要在棋盘里弹自己的结算。

## 4. 材质与配色

- 外围控件（按钮、标签、分数条、提示）**只用黑白灰**；颜色只出现在棋盘与棋子上。
- 每个游戏在 `tokens.css` 定义一组 `--palette-<game>-*`（主色 + 深色 + 浅色），在 `games.css` 映射到三个槽：

```css
[data-game="gomoku"] {
  --game: var(--palette-gomoku-board);       /* 签名色：图标底色 */
  --game-ink: var(--palette-gomoku-stone-black);  /* 图标前景 */
  --game-2: var(--palette-gomoku-stone-white-deep); /* 第二色 */
}
```

- 深色主题下不改调色板：靠 `--surface` 与中性色自适应；棋盘材质保持自己的明度。
- 禁止在组件里写裸色值（`#rrggbb` / `rgb()`），`pnpm --filter @llmgames/web lint:css` 会直接失败。
- 字号、间距必须用 `--type-*` / `--space-*`，同样由 lint 卡住。

## 5. 图标与插画

- `GameMark`：10×10 字符网格，`#` = `--game-ink`，`a`/`b` = 两个辅色；10 行 × 10 列，不能多不能少。
- `GameScene`：96×64 画布，只用现有图元（`R`/`F`/`T`/`Disc`/`Glow`）；`level` 只能是 2/4/6/8/10/12。
- 两者都要在**深色卡片**上可读——这是最常见的翻车点：浅色棋盘配浅色墨会糊成一片。
- 不允许用 emoji、Unicode 字符或外链图片顶替。

## 6. 文案

- 五键必备：`game.<id>.{title,category,detail,hook,hint}`；棋盘无障碍名 `board.<id>Board`。
- 棋盘内提示用 `board.<id>…` 命名空间；不要复用别的游戏的句式（"Choose a column" 在五子棋里是错的）。
- 中英文同步；英文颜色/状态词保持小写（`black`/`white`），否则依赖无障碍名的 e2e 会挂。
- 机器协议字段不翻译。

## 7. 预览与截图

- `/design-preview/<id>` 必须能出至少三种状态：开局、进行中、终局；多人游戏再加满员大厅与特殊阶段。
- `previewFixtures.ts` 提供该游戏的基础投影，`previewScenarios.ts` 负责变体；棋盘尺寸与真实对局一致。
- 截图存 `docs/screenshots/m4-<game>-*.png`，并与"最接近的既有游戏"对照（五子棋↔Reversi、飞行棋↔Battleship、牌类↔Poker）。

## 8. 验收清单（缺一不可）

1. 目录里能看到图标、插画、介绍，且点击进入房间。
2. 大厅、席位、计时器、结果面板与其他游戏一致。
3. 棋盘/手牌/地图能完整表达当前局面。
4. 中英文都能用，无回退到 key 的文本。
5. 390×844、844×390 下无横向溢出，主要操作可点。
6. 观战者看不到私有信息，且能看完整对局。
7. 回放能渲染每一步，终局棋盘正确。
8. 落子/出牌有反馈（音效/位移/高亮），不过度动画。
9. `pnpm --filter @llmgames/web lint:css` 通过。
10. `scenario-layout` 四视口用例通过。
