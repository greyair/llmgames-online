# i18n 首屏语言闪烁修复

**目标：** 中文用户第一次进入站点时，首屏关键文案从第一次可见绘制起就是中文，而不是先看到英文、等 React 切换。

**结论（精确版）：** 首页 Hero、导航、加载兜底文案、以及 `/play` 与 `/connect-ai` 的页眉和工具条实现了**零错误语言闪烁**——错误语言可见窗口从 1.4 s / 1.0 s 降到 0。**游戏卡片网格仍是英文**（`/play` 首屏 1440 下 32 条、390 下 4 条），这是本次有意留下的边界，原因见第 9 节。

> **修订说明（v2）：** 初版报告把结论写成「首屏关键文案」，但实际只覆盖了 Hero 与导航，`/play` 的房间码标签、加入按钮、筛选项、系列赛入口仍是英文。经复核确认属实，本轮已补齐这些文案，并把结论收窄到「页眉 / 工具条 / 导航 / Hero」，同时用一条会失败的测试把剩余英文钉住。第 9 节给出逐条实测清单。

---

## 1. 根因与实际渲染链路

问题不是「翻译没做」，而是**翻译的时机晚于绘制**。链路是四步：

1. **构建期把英文烘进 HTML。** `BaseLayout.astro` 里的 `<Landing client:load/>`、`<SiteBar client:load/>` 是服务端渲染孤岛，`pnpm build` 时 Astro 就把它们渲染成英文 HTML 写进 `dist/index.html`。
2. **Hydration 被强制从英文开始。** `apps/web/src/i18n/core.ts`：

   ```ts
   /** The pre-rendered HTML is English, so hydration must start from English. */
   function serverSnapshot(): Locale { return "en"; }
   ```

   这是刻意为之：`useSyncExternalStore` 在 hydration 那一帧必须与服务端输出一致，否则 React 判定 mismatch 并丢弃整棵子树。
3. **切换发生在 hydration 之后的下一帧。** 首帧比对完成后 React 才读到真实语言并重渲染。所以英文窗口 ≈ JS 下载 + React 启动 + 孤岛 hydration 的总时长。
4. **`<html lang>` 早已是中文。** `public/locale-init.js` 在首绘前写好 `root.lang` 与 `root.dataset.locale`。它改得动属性，改不动已经烘进 HTML 的文本——于是那 1 秒里文档声称中文、屏幕显示英文。

前置实测（修复前）：

| 页面 | 英文首次出现 | 切成中文 | 英文窗口 |
| --- | --- | --- | --- |
| `/` | 410 ms | 1609 ms | ≈ 1.2 s |
| `/play` | 47 ms | 731 ms | ≈ 0.68 s |

另有 `apps/web/astro/pages/[...path].astro` 中写死的 `Loading…`：所有 `client:only` 页面的首屏兜底文案，中文用户永远看到英文。

## 2. 采用的修复方法

**方案 D：关键首屏文案双语预渲染 + 局部语言语义修正。**

- `BilingualText` 组件：同一次渲染里输出 `<span lang="en" data-i18n-text="en">` 与 `<span lang="zh-CN" data-i18n-text="zh">`。
- `src/design/bilingual.css`：用 `html[data-locale]` 决定哪个节点可见，隐藏侧 `display: none`。
- 语言选择由 CSS 完成，不等 React，切换语言时这些文案立即重绘。

未采用：A 整页遮罩（1.2 s 空白 + JS 失败即白屏）、B 只延迟 `lang`（闪烁依旧）、C `/zh/*` 路由（成本最大，超出本次范围）。

**边界（重要）：** 双语只用于「hydration 前就会显示、且属于界面骨架」的静态文案，即导航、页眉、工具条、表单控件标签、加载兜底、Hero。**内容区不改造**：游戏卡片网格、对局界面、账号页。

## 3. 修改文件列表

| 文件 | 改动 |
| --- | --- |
| `apps/web/src/i18n/BilingualText.tsx` | **新增**。`k` 接受单个键或键数组（数组用于把一句话拼成一个文本节点） |
| `apps/web/src/design/bilingual.css` | **新增**。可见性规则，默认英文，`data-locale="zh-CN"` 切中文 |
| `apps/web/src/index.css` | 引入 `bilingual.css` |
| `apps/web/src/i18n/index.ts` | 导出 `BilingualText` |
| `apps/web/src/i18n/locales/en.ts` / `zh-CN.ts` | 新增 `common.loading`、`common.loadingPage` |
| `apps/web/src/interface/Landing.tsx` | Hero 标题前缀/后缀、`sr-only` 完整句、8 个轮播游戏名、副标题、两个 CTA、三个统计标签；街机条游戏名、`Demo` 标签、棋盘提示 |
| `apps/web/src/interface/WireDiagram.tsx` | 「如何运作」小标题与导语 |
| `apps/web/src/interface/site-bar/SiteNav.tsx` | 导航标签（桌面 bar 与移动 dock） |
| `apps/web/src/interface/site-bar/SiteAccount.tsx` | `Sign in`、`Profile` 可见文案 |
| `apps/web/src/interface/Library.tsx` | `/play` 的 h1、导语、房间码标签、加入按钮、三个筛选项、系列赛入口 |
| `apps/web/src/interface/PublicPages.tsx` | `/connect-ai` 的 h1 与导语 |
| `apps/web/src/components/ui/loading-panel.tsx` | 新增 `labelKey`，`label` 改为可选 |
| `apps/web/src/components/ui/holey-loader.tsx` | 新增 `labelKey`，渲染双语标签 |
| `apps/web/astro/pages/[...path].astro` | 两处 `label="Loading…"` → `labelKey="common.loading"` |
| `apps/web/src/App.tsx` | 路由 Suspense 兜底 → `labelKey="common.loadingPage"` |
| `apps/web/e2e/hero.spec.ts` | 轮播断言改为读可见语言节点 |
| `apps/web/e2e/locale-switch.spec.ts` | 标题断言读 `innerText`；**新增首屏审计用例**（见第 8 节） |
| `apps/web/e2e/loading.spec.ts` | 无 JS 用例改为断言「英文可见、中文节点隐藏」 |
| `apps/web/e2e/public.spec.ts` | h1 存在性断言允许内部有语言 span |

## 4. 双语节点如何保证 SSR 与 Hydration 一致

**组件恒渲染两个 span，没有条件分支、没有 hooks、不读 `useLocale()`。**

```tsx
export function BilingualText({ k, vars }: BilingualTextProps) {
  const keys = Array.isArray(k) ? k : [k];

  const read = (locale: Locale) => keys.map((key) => translate(locale, key, vars)).join("");

  return (
    <>
      <span lang="en" data-i18n-text="en">{read("en")}</span>
      <span lang="zh-CN" data-i18n-text="zh">{read("zh-CN")}</span>
    </>
  );
}
```

由此得到三条性质：

1. **服务端、hydration 首帧、之后每次渲染输出完全相同**——组件不看任何环境状态，`translate()` 是纯函数。
2. **语言切换不经过 React**：`setLocale()` 改的是根元素上的 `data-locale`，这些节点不动，不会重挂载。
3. **「SSR 输出双语、客户端输出单语」这类反例被结构性排除**——组件没有 `typeof window` 分支。

`sr-only` 里的完整句子用键数组传入，让一句中文成为一个文本节点——拆成两个 span 会在可访问名里插入空格（实测把 `Connect 4?` 变成 `Connect 4 ?`）。

## 5. `html lang` 与无 JavaScript 环境

- `locale-init.js` 保持不变：仍在首绘前由 `用户选择 > 浏览器语言 > en` 决定并写入 `data-locale`，同时设置 `<html lang>`。
- 每个双语节点带自己的 `lang="en"` / `lang="zh-CN"`。
- **无 JS：** 没有 `data-locale`，样式表默认只显示英文，页面呈现完整可读英文，不会全部隐藏。`loading.spec.ts:122` 断言了这一点。
- 未修改语言识别顺序与 `localStorage` 机制。

**仍未全站解决的语义问题：** 中文环境下，以下内容仍是 `html lang="zh-CN"` + 英文可见文字，或英文可访问名——

- 游戏卡片网格（可见文字 + `aria-label="Play <game>"`）；
- `/play` 加入房间表单的 `placeholder` 与输入框 `aria-label`；
- 移动 dock 的 `aria-label`（缩写链接的全称），属性随 hydration 更新；
- `/watch`、`/games/*`、`/privacy`、`/terms`、`/ai-spec` 整页（未纳入本轮）；
- `site.skip`（仅聚焦时可见）。

这一条**没有解决**，报告不再声称它已解决。

## 6. 修改前后首屏实测数据

方法：生产构建产物（静态服务器托管，`cache-control: no-store`）+ Google Chrome headless（`channel: chrome`）+ `locale: zh-CN`，每页 5 次取中位数。检测**可见文本**（`innerText`），不是 `lang` 属性。

| 页面 | 第一帧可见（FCP） | 错误语言首次出现 | 正确语言完成 | 错误语言窗口 |
| --- | --- | --- | --- | --- |
| `/` 改前 | 404 ms | 80 ms | 1495 ms | **1415 ms**（样本 1164–1547） |
| `/` 改后 | 388 ms | 未出现 | 78 ms | **0 ms**（5/5 为 0） |
| `/play` 改前 | 332 ms | 85 ms | 1060 ms | **975 ms**（样本 889–1262） |
| `/play` 改后 | 336 ms | 未出现 | 84 ms | **0 ms**（5/5 为 0） |

补充验证：

- **站内跳转** `/` → `/connect-ai`（中文环境）：126 帧可见采样内没有任何英文帧。
- **手动切换语言**：h1、副标题、CTA、导航、轮播游戏名（`Codenames` ↔ `行动代号`、`Reversi` ↔ `黑白棋`、`Pokémon` ↔ `宝可梦`）即时切换；刷新保持；再切回正常。
- **Hydration**：`hero.spec.ts › public landing hydrates without markup errors` 通过（监听 `pageerror` 与含 `hydration-mismatch` 的 console 错误，结果为空）；axe WCAG 2 A/AA + 2.1 AA 零违规。

## 7. 截图

均取自最终构建产物（`docs/screenshots/i18n-first-paint/`）：

| 说明 | 文件 |
| --- | --- |
| 桌面 1440 中文首页 | `home-zh-1440.png` |
| 桌面 1440 英文首页 | `home-en-1440.png` |
| 手机 390 中文首页 | `home-zh-390.png` |
| 手机 390 英文首页 | `home-en-390.png` |
| 手机 360 中文首页 | `home-zh-360.png` |
| 游戏目录 1440 中文 / 英文 | `play-zh-1440.png` / `play-en-1440.png` |
| 游戏目录 390 中文 | `play-zh-390.png` |
| 接入页 1440 中文 | `connect-ai-zh-1440.png` |

横向溢出：360 / 390 / 1440 三档 × 中英两语言，`scrollWidth - innerWidth` 均为 **0**。

## 8. 测试命令与真实通过数量

```bash
pnpm lint                                  # 8/8 任务通过（含 strict type check、design tokens、ai-spec）
pnpm --filter @llmgames/web test           # 11 文件 / 336 用例通过
pnpm --filter @llmgames/web exec playwright test --config playwright.local.config.ts \
  hero.spec.ts locale-switch.spec.ts loading.spec.ts    # 7 + 20 + 8 = 35 passed
pnpm build                                 # web + workers 两任务成功，47 个 JS/CSS 资源
```

回归补充：`library-join.spec.ts public.spec.ts page-transitions.spec.ts` **41 passed**。

### 新增的首屏审计用例

`locale-switch.spec.ts › first visit › paints the first screen in Chinese before hydration`：

- 拦截所有 `script` 请求，**只放行 `locale-init.js` 与 `theme-init.js`**——`data-locale` 会被写入、样式表照常生效，但没有任何孤岛 hydration。该做法在生产构建与 dev 下都成立（两者都把样式表与孤岛 bundle 分开提供），因此不会像只拦 `/_astro/*.js` 那样在 dev 下静默失效。
- 断言 `<html data-locale="zh-CN">`、Hero 前缀中文、导航中文、`挑战 AI` 按钮可见；随后到 `/play` 断言 h1、房间码标签、加入按钮、系列赛入口、筛选项均为中文。
- 再用 `untranslated()` 扫描首屏可见文本节点（跳过 `sr-only`、跳转链接、品牌标识、被样式隐藏的语言、视口外内容），把**剩余的纯英文串直接列进失败信息**：

  ```
  Error: untranslated first-screen copy on /play : Have a room code? | Join room | ...
  ```

  游戏名保留拉丁写法（`LATIN_ALLOWED`），其余一律算回归。

写这条测试时它先抓到了品牌标识 `llmgames` / `.online`——按「品牌标识不译」排除，而不是把字符串塞进白名单。

### 关于既有断言的改动

初版改动后有 18 个既有用例失败，全部是两类原因，且都不是削弱：

1. `toHaveText` 读 `textContent`，双语节点会得到 `"Connect 4Connect 4"` → 改为断言**可见语言节点**或 `innerText` 轮询。
2. `sr-only` 被拆成两个 span 导致可访问名多出空格 → 在**组件层**修复（键数组合并成单文本节点），测试保持原样。

本轮另外修正 `public.spec.ts` 一条断言：它用 `/<h1[^>]*>[^<]+<\/h1>/` 检查预渲染 h1 有文字，而 `/setup` 的 h1 现在内含语言 span。改为剥掉标签后检查文本非空，意图不变。

## 9. 残留英文闪烁区域与原因

实测方法：阻断所有脚本（保留 `locale-init.js`）后，统计首屏（视口内）可见文本节点中的纯英文串。

| 区域 | 实测残留 | 原因 |
| --- | --- | --- |
| `/play` 游戏卡片网格 | 1440 下 32 条、390 下 4 条（卡片名、`2 players`、分类、简介） | **有意不改造**：每个卡片的可访问名是拼好的属性 `aria-label="Play <game>"`，属性无法双语；只把可见文字改成双语，会让中文界面的每张卡片都被读成英文——正是本次要消除的那种错配。要改造必须先去掉该属性或复制链接（后者被禁止） |
| `/watch`、`/games/*`、`/privacy`、`/terms`、`/ai-spec` | 整页英文首屏 | 同样是预渲染孤岛，本轮未纳入范围 |
| `/play` 表单属性 | `placeholder`、输入框 `aria-label` | 属性无法双语，随 hydration 更新 |
| 移动 dock `aria-label` | 缩写链接的全称 | 同上 |
| 账号页错误态 | 例如 `无法检查你的账户 / Could not verify your session` | 运行时接口错误文案，与首屏渲染无关 |
| `site.skip` | `Skip to content` | 仅聚焦可见，未改造 |

## 10. 对 SEO、性能与可访问性的影响

**SEO**：无影响。首屏仍是完整预渲染内容，没有隐藏 `body`/`main`，未增加双 URL 或 hreflang。

**性能**（生产构建，未压缩 / gzip）：

| 页面 | 改前 | 改后 | 增量 | gzip 增量 |
| --- | --- | --- | --- | --- |
| `/` | 147 487 B | 150 235 B | +2 748 B（+1.86%） | **+655 B**（+1.61%） |
| `/play` | 91 065 B | 92 325 B | +1 260 B（+1.38%） | **+304 B**（+1.27%） |
| `/connect-ai` | 26 600 B | 27 307 B | +707 B（+2.66%） | **+215 B**（+2.60%） |

FCP 无回归（`/` 404→388、`/play` 332→336，均在 5 次采样抖动内）；JS bundle 只增加两个纯函数组件，无新依赖。

**布局**：改前改后逐元素测量完全一致（1440×900，中英两语言）：

```
en-US  h1 500×216@220  subline 398×21@460  actions 433×56@514  hero 1200×666@104  docHeight 5516
zh-CN  h1 500×216@220  subline 399×21@460  actions 356×56@514  hero 1200×666@104  docHeight 5472
```

**可访问性**：隐藏侧 `display: none`，不参与布局也不进可访问树，标题与按钮只被朗读一次；可见节点带正确 `lang`；Hero 可访问名与改造前逐字一致；axe 零违规。**但第 5 节列出的属性类名称问题仍未解决**，不视为已修复。

## 11. Commit

- 基础修复：`38a0589` — *Paint the first screen in the visitor's language*
- 首屏补全 + 审计测试：`912f897` — *Translate the rest of the first screen*
- 报告与截图：本文件所在提交

未部署生产环境。
