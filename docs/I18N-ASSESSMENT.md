# 前端汉化与语言切换：复杂度评估

调查时间：2026-10-29 · 基线 `fda5e50` · 只做可行性评估，未改动任何代码

## 1. 现状调研（实测数据，非估计）

| 项目 | 实测 |
| --- | --- |
| 前端技术栈 | Astro `output: "static"` + React 客户端路由，单入口 `astro/pages/[...path].astro` |
| 已有 i18n 基础 | **无**。全仓无 `i18n` / `locale` / `useTranslation`，仅 `toLocaleString()` 本地化数字 |
| `<html lang>` | 硬编码 `lang="en"`，`og:locale` 硬编码 `en_US` |
| 组件文件 | 85 个 `.tsx`、45 个 `.ts`，约 19,000 行 |
| 界面文案（确定项） | 约 **540 处**（JSX 文本 + `aria-label`/`title`/`placeholder`/`alt`） |
| 多词字符串（含误报） | **1,301 条去重 / 1,861 处出现 / 44,769 字符**（约 7,000–7,500 英文单词） |
| 单文件文案最多 | `gameRules.ts`(115)、`aiSpecData.ts`(87)、`Series.tsx`(69)、`Room.tsx`(67)、`Landing.tsx`(66)、`LobbySetup.tsx`(62) |
| 游戏规则说明 | `interface/gameRules.ts` —— 86 条 / 8,063 字符（8 款游戏各自分步说明） |
| 游戏目录 | `interface/catalog.ts` —— 8 游戏 × 4 字段（title/players/category/detail） |
| 游戏结束文案 | `features/shared/gameOverCopy.ts` —— 334 行，集中，易处理 |
| 页面 metadata | `lib/siteMetadata.ts` —— 12 组页面 title/description + 8 个游戏页 + 首页 |
| 服务端错误文案 | `apps/workers` 中 **154 处** `error: "..."`，前端直接展示给用户 |
| 法律文本 | `content/legal.json` —— privacy 6,063 + terms 5,350 字符（约 1,900 词） |
| 长段落（>60 字符） | 约 40–50 条，集中在 `McpInstallCommand`、`PublicPages`、`WireDiagram`、`Series` |
| 字体 | `--font-ui/code/pixel` 均为 Geist 系列，**无中文字体栈** |
| e2e 测试 | 46 个 spec，**775 处**依赖英文文案（`getByText` / `getByRole(name:)` / `toContain("…")`） |
| 单元测试 | web 10 文件 323 用例，多为领域逻辑，受语言影响小 |

## 2. 复杂度判断

**总评：中等偏上，但不是架构风险。** 真正的难点不在技术，在两件事：

1. **文案量大且分散**（85 文件、约 1,000 个词条），属机械工作量，但每次替换都要过一遍 tsc + lint + 测试；
2. **有 775 处测试断言写死了英文**，一旦切换默认语言就全红——必须先锁定 e2e 的语言环境，否则改一片红一片。

技术侧其实是**利好**的：项目是静态壳 + 客户端 React 路由，语言切换只需一处 Provider，不需要为每个页面做服务端 i18n 路由。而且已有 `public/theme-init.js` 这个先例——同样的模式可以解决"首屏语言闪烁"。

## 3. 工作量估算

按**一名熟悉该代码库的前端 + 一名译者**口径（人日）：

| 阶段 | 内容 | 人日 |
| --- | --- | --- |
| 1. 基础设施 | `LocaleProvider`、`t()`、词条类型安全（缺 key 编译报错）、持久化、`locale-init.js` 防闪烁、切换器 UI、`<html lang>` / `og:locale` 动态化 | 2–3 |
| 2. 抽取文案 | 85 个文件分批迁移，每批 `tsc` + `lint` + `test` 验收 | 4–6 |
| 3. 翻译与审校 | 约 7,000 词；AI 初译 + 人工统一术语、语气（产品是"手绘/像素"调性，直译会失真） | 3–4 |
| 4. 集中文案块 | `gameRules.ts`(86 条)、`catalog.ts`、`gameOverCopy.ts` | 1–1.5 |
| 5. 服务端错误映射 | 154 条 → 前端按 `error.code` 映射，未知码回落英文 | 1.5–2 |
| 6. 字体与排版 | CJK 字体栈、`--font-pixel` 在中文下的 fallback、按钮/chip/表格溢出走查 | 2–3 |
| 7. 测试 | e2e 固定 `en` locale（新增 fixture）+ 中文冒烟 3–5 条 | 1.5–2 |
| 8. 回归 | 8 款游戏 × 建房/对局/结算/回放 视觉走查 | 2 |
| **合计** | | **17–24 人日** |

换算：单人全职约 **3.5–5 周**；两人并行（一人抽码、一人翻译）约 **2.5–3 周**。

### 三个范围选项

| 方案 | 增量 | 合计 |
| --- | --- | --- |
| **A. 仅界面切换**（SEO 保持英文，URL 不变） | — | 17–24 人日 |
| **B. A + 双语 SEO 路由**（`/zh/...`、`hreflang`、双份预渲染、sitemap） | +3–5 人日 | 20–29 人日 |
| **C. B + 内容本地化**（中文代号词库、中文猜词表、Pokémon 中文名） | +5–10 人日，且依赖数据源与产品决策 | 25–39 人日 |

**建议先做 A**。A 已经能覆盖"页面上可以选择语言"这个需求；B 的收益只在搜索引擎收录中文页面，而本站在中国大陆访问不稳定，SEO 收益要打折。

## 4. 关键技术判断

### 4.1 语言切换只能客户端做（因为 `output: "static"`）

单入口 `[...path].astro` + `getStaticPaths()` 在构建期展开所有路径。要在构建期产出中文 HTML，必须把路径扩成 `zh/*` 双份（即方案 B）。

方案 A 的做法：

```
public/locale-init.js   ← 在 <head> 同步执行，早于样式与首屏绘制
  → 读 localStorage("llmgames-locale") → 无则 navigator.language 以 zh 开头则 zh，否则 en
  → document.documentElement.lang = locale
  → document.documentElement.dataset.locale = locale
```

这与现有 `theme-init.js` 完全同构（`BaseLayout.astro` 已有 `<script is:inline src="/theme-init.js">`），风险最低、无闪烁。

### 4.2 服务端消息**不要翻译**

`apps/workers` 那 154 条 `error: "..."` 是 MCP 工具契约的一部分，AI 客户端也在读。翻译它们会：

- 破坏既有断言（例如我刚写的 `expect.stringContaining("at least")`、`Match length for connect4 is limited to 45 minutes`）；
- 改变 MCP 对外语义（M2 约束里明确要求"不破坏现有调用方式"）；
- 让 `check:ai-spec` 与 `ai-spec.json` 产生歧义。

正确做法：**服务端继续返回英文 message + 稳定的 `code`，前端按 code 查中文表**，未命中回落英文。`publicActionError()` 已经带 `code`/`category`/`recovery`，字段够用，不需要改协议。

### 4.3 中文字体是必须做的事，不是可选项

`tokens.css` 只有 Geist（含 `--font-pixel`）。中文会 fallback 到系统字体，导致：

- 像素风标题在中文下失去质感（Geist Pixel 没有中文字形）；
- 中英文混排时基线/字重跳变；
- Windows 默认 fallback 常是宋体，与整体调性冲突。

需要补 `--font-ui-cjk`（Noto Sans SC 或系统栈 `"PingFang SC", "Microsoft YaHei", "Noto Sans SC"`），并决定 pixel 标题的降级策略（推荐：中文标题改用 `--font-ui-cjk` + 加粗，保留字号与字距）。

### 4.4 测试必须先固定语言

46 个 e2e / 775 处英文断言。做法：新增 `e2e/session-seed.ts` 同级 fixture，在 `addInitScript` 里写 `localStorage.setItem("llmgames-locale", "en")`，让全部既有 e2e 跑英文。

不这么做，改造期间每天都是几百条红，无法判断真回归。

### 4.5 明确**不翻译**的部分

| 内容 | 原因 |
| --- | --- |
| `ai-spec.json`（197 KB） | AI 契约，`check:ai-spec` 会校验；翻译即改协议 |
| `aiSpecData.ts`（87 条） | 字段级技术说明，受众是接 AI 的开发者 |
| `game-catalog` 里给 AI 的规则描述 | 同上，属 MCP 工具文档 |
| Contexto 词表 | 游戏内容就是英文猜词，改了等于换游戏 |
| Pokémon 名称 | 需中文译名表，属方案 C |
| 玩家代号（SlyAnvil 类） | 英文代号是现有身份体系的一部分，中文化需产品决策 |

## 5. 需要你先定的 6 件事

1. **范围**：A（仅界面）/ B（+双语 SEO）/ C（+内容本地化）？
2. **默认语言**：新访客默认中文，还是跟随浏览器？现有用户（英文）是否要保持英文不被打扰？
3. **术语表**：`room`→房间、`seat`→座位、`controller`→控制器、`agent`→智能体/AI、`series`→系列赛、`codename`→代号、`codename clue`→线索。带 AI 语义的词（controller/agent）翻译会影响用户对 MCP 概念的理解，需要你拍板。
4. **服务端错误**：同意"保持英文 + 前端按 code 映射"吗？
5. **是否要繁体**：第三语言会让翻译与审校成本 +40%，但词条表结构不变。
6. **URL 是否带语言前缀**（`/zh/play`）：影响分享链接与已有链接兼容；方案 A 下不需要，方案 B 下必须。

## 6. 风险清单

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| 775 处 e2e 英文断言 | 改造期无法判断真回归 | 先固定 e2e 为 `en` fixture，再动代码 |
| 文案抽取破坏 JSX 结构（三元、模板串、条件渲染） | 编译错误、局部渲染异常 | 按文件分批，每批 `tsc`+`lint`+`test` |
| 服务端消息被误翻 | 破坏 MCP 契约与既有测试 | 只在前端做映射层，worker 不动 |
| 中文排版溢出（按钮、chip、表格、`MatchDesk`） | 视觉回归 | 专项走查 8 游戏 + 320 宽小屏 |
| 像素字体在中文下失效 | 品牌调性受损 | 中文标题改 CJK 字重方案，先出 2 页样张确认 |
| 首屏语言闪烁 | 体验问题 | `locale-init.js` 同步注入，与主题同模式 |
| localStorage 与账号不同步 | 换设备语言不一致 | v1 存本地即可；要跨设备需加 `users.locale` 字段（含 D1 迁移，需你批准） |

## 7. 与 M3 的先后关系（重要）

M3 计划把游戏钩子固化成 `GamePlugin` 契约。**i18n 的词条边界会影响这个契约**：如果游戏文案（规则、回合提示、结算文案）要跟随插件走，那 `GamePlugin` 就该带 `strings` 命名空间。

如果先做 M3 再做 i18n，插件接口要返工一次。建议顺序：

1. **先做 i18n 基础设施 + 非游戏页面**（阶段 1、2 的一部分），确定词条命名空间约定（`common.*` / `game.connect4.*` / `error.*`）；
2. 再进 M3，把命名空间写进 `GamePlugin`；
3. 最后补齐 8 款游戏的游戏内文案。

这样两边都不用返工。

## 8. 结论

- 复杂度：**中等偏上**，无架构性阻塞，主要是量的问题；
- 人日：方案 A **17–24 人日**（单人 3.5–5 周，双人 2.5–3 周）；
- 最大隐性成本不是翻译，是 **775 处 e2e 断言**与**中文排版走查**；
- 建议先做 A，且**在 M3 之前完成基础设施**，避免插件契约返工。
