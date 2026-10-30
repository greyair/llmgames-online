# i18n 首屏语言闪烁修复

**目标：** 中文用户第一次进入站点时，首屏关键文案从第一次可见绘制起就是中文，而不是先看到英文、等 React 切换成中文。

**结论：** 首屏双语预渲染 + `html[data-locale]` CSS 切换。落地页与游戏目录的错误语言可见窗口从 **1205 ms / 823 ms 降到 0 ms**，FCP、布局、可访问名、Hydration 全部无回归。

---

## 1. 根因与实际渲染链路

问题不是「翻译没做」，而是**翻译的时机晚于绘制**。链路是四步：

1. **构建期把英文烘进 HTML。** `BaseLayout.astro` 里的 `<Landing client:load/>`、`<SiteBar client:load/>` 是服务端渲染孤岛，`pnpm build` 时 Astro 就把它们渲染成英文 HTML 写进 `dist/index.html`。实际产物里能看到 `<h1 class="reveal">Can your AI beat you at <span class="sr-only">Connect 4?</span>…`。
2. **Hydration 被强制从英文开始。** `apps/web/src/i18n/core.ts`：

   ```ts
   /** The pre-rendered HTML is English, so hydration must start from English. */
   function serverSnapshot(): Locale { return "en"; }
   ```

   这是刻意为之：`useSyncExternalStore` 在 hydration 那一帧必须与服务端输出一致，否则 React 判定 mismatch 并丢弃整棵子树。
3. **切换发生在 hydration 之后的下一帧。** 首帧比对完成后 React 才读到真实语言（`snapshot()` → `zh-CN`）并重渲染。所以英文窗口 ≈ JS 下载 + React 启动 + 孤岛 hydration 的总时长。
4. **`<html lang>` 早已是中文。** `public/locale-init.js` 在首绘前读 localStorage 与 `navigator.languages`，写好 `root.lang` 和 `root.dataset.locale`。它改得动属性，改不动已经烘进 HTML 的文本——于是那 1 秒里文档声称中文、屏幕显示英文。

前置实测（严格按上述链路，非本次修复后的数据）：

| 页面 | 英文首次出现 | 切成中文 | 英文窗口 |
| --- | --- | --- | --- |
| `/` | 410 ms | 1609 ms | ≈ 1.2 s |
| `/play` | 47 ms | 731 ms | ≈ 0.68 s |

另有 `apps/web/astro/pages/[...path].astro` 中写死的 `Loading…`：所有 `client:only` 页面的首屏兜底文案，与 i18n 系统完全无关，中文用户永远看到英文。

## 2. 最终采用的修复方法

**方案 D：关键首屏文案双语预渲染 + 局部语言语义修正。**

- 新增 `BilingualText` 组件：同一次渲染里输出 `<span lang="en" data-i18n-text="en">` 与 `<span lang="zh-CN" data-i18n-text="zh">` 两个节点。
- 新增 `src/design/bilingual.css`：用 `html[data-locale]` 决定哪个节点可见，隐藏侧用 `display: none`。
- 语言选择由 CSS 完成，**不需要等 React 再跑一遍**，因此切换语言时这些文案立即重绘。

未采用的三条路：

| 方案 | 为什么不用 |
| --- | --- |
| A 整页 pending 遮罩 | 把 1.2 s 英文换成 1.2 s 空白，LCP 变差，且 JS 失败即永久白屏 |
| B 只延迟 `<html lang>` | 闪烁依旧，只是语义不再错配 |
| C `/zh/*` 路由或 Pages Function 重写 | 效果最好但成本最大（双倍页面、全站链接改写、hreflang），超出本次范围 |

## 3. 修改文件列表

| 文件 | 改动 |
| --- | --- |
| `apps/web/src/i18n/BilingualText.tsx` | **新增**。双语文案组件，`k` 接受单个键或键数组（数组用于把一句话拼成一个文本节点） |
| `apps/web/src/design/bilingual.css` | **新增**。`[data-i18n-text]` 可见性规则，默认英文，`data-locale="zh-CN"` 时切中文 |
| `apps/web/src/index.css` | 引入 `bilingual.css` |
| `apps/web/src/i18n/index.ts` | 导出 `BilingualText` |
| `apps/web/src/i18n/locales/en.ts` / `zh-CN.ts` | 新增 `common.loading`、`common.loadingPage` |
| `apps/web/src/interface/Landing.tsx` | Hero 标题前缀/后缀、`sr-only` 完整句、8 个轮播游戏名、副标题、两个 CTA、三个统计标签 |
| `apps/web/src/interface/site-bar/SiteNav.tsx` | 导航标签（桌面 bar 与移动 dock 共用同一渲染分支） |
| `apps/web/src/interface/site-bar/SiteAccount.tsx` | `Sign in`、`Profile` 可见文案 |
| `apps/web/src/interface/Library.tsx` | `/play` 的 h1 与导语 |
| `apps/web/src/interface/PublicPages.tsx` | `/connect-ai` 的 h1 与导语 |
| `apps/web/src/components/ui/loading-panel.tsx` | 新增 `labelKey`，`label` 改为可选 |
| `apps/web/src/components/ui/holey-loader.tsx` | 新增 `labelKey`，渲染双语标签 |
| `apps/web/astro/pages/[...path].astro` | 两处 `label="Loading…"` → `labelKey="common.loading"` |
| `apps/web/src/App.tsx` | 路由 Suspense 兜底 `label="Loading page…"` → `labelKey="common.loadingPage"` |
| `apps/web/e2e/hero.spec.ts` | 轮播断言改为读可见语言节点 |
| `apps/web/e2e/locale-switch.spec.ts` | 标题断言改为读 `innerText`（渲染后的文本） |
| `apps/web/e2e/loading.spec.ts` | 无 JS 用例改为断言「英文可见、中文节点隐藏」 |

## 4. 双语节点如何保证 SSR 与 Hydration 一致

**组件恒渲染两个 span，没有任何条件分支、没有 hooks、不读 `useLocale()`。**

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

1. **服务端、hydration 首帧、以及之后的每次渲染，输出完全相同。** 组件不看任何环境状态，`translate()` 是纯函数，两个词库在构建期就已烘进 bundle。
2. **语言切换不经过 React。** 切语言时 `setLocale()` 改的是 `document.documentElement` 上的 `data-locale`，这些节点一个字节都不动，因此不会触发重挂载，也不会出现「React 换了一棵树、CSS 还是旧的」这种中间态。
3. **反例被结构性地排除。** 如果按「SSR 输出双语、客户端只输出单语」来写（例如在组件里判断 `typeof window !== "undefined"`），hydration 必然 mismatch。本组件没有这种分支。

`sr-only` 里的完整句子用键数组传入（`k={[gameTitleKey, "landing.hero.titleSuffix"]}`），让一句中文成为一个文本节点——拆成两个 span 会在可访问名里插入空格（实测会把 `Connect 4?` 变成 `Connect 4 ?`）。

## 5. `html lang` 与无 JavaScript 环境

- `locale-init.js` 保持不变：仍在首绘前由 `用户选择 > 浏览器语言 > en` 决定并写入 `data-locale`，同时设置 `<html lang>`。因为关键首屏现在**确实**是中文，`lang="zh-CN"` 与环境一致，不再出现「文档声称中文、内容是英文」。
- 每个双语节点各自带 `lang="en"` / `lang="zh-CN"`，屏幕阅读器与断词按节点语言处理。
- **无 JS：** 没有 `data-locale`，样式表默认只显示 `[data-i18n-text="en"]`，页面呈现完整可读英文，不会出现「全部文案被隐藏」。`e2e/loading.spec.ts:122` 正是断言这一点：`"Loading…"` 可见、`[data-i18n-text="zh"]` 为 hidden、加载面板本身仍可见。
- 未修改语言识别顺序与 `localStorage` 机制。

## 6. 修改前后首屏实测数据

方法：生产构建产物（`pnpm build` 后由静态服务器托管，`cache-control: no-store`）+ Google Chrome headless（`channel: chrome`）+ `locale: zh-CN`，每页各跑 5 次取中位数。检测的是**可见文本**（`innerText`，`display:none` 不计入），不是 `document.documentElement.lang`。

| 页面 | 第一帧可见（FCP） | 错误语言首次出现 | 正确语言完成 | 错误语言窗口 |
| --- | --- | --- | --- | --- |
| `/` 改前 | 340 ms | 77 ms | 1282 ms | **1205 ms**（样本 1126–1285） |
| `/` 改后 | 344 ms | 未出现 | 74 ms | **0 ms**（5/5 为 0） |
| `/play` 改前 | 248 ms | 70 ms | 893 ms | **823 ms**（样本 811–849） |
| `/play` 改后 | 272 ms | 未出现 | 69 ms | **0 ms**（5/5 为 0） |

补充验证：

- **站内跳转** `/` → `/connect-ai`（中文环境）：126 帧可见采样内**没有任何英文帧**（改造前该页 h1 会短暂显示 `Connect any AI agent via remote MCP`）。
- **手动切换语言**：h1、副标题、CTA、导航、轮播游戏名（`Codenames` ↔ `行动代号`、`Reversi` ↔ `黑白棋`、`Pokémon` ↔ `宝可梦`）即时切换；刷新后保持；再切回中文正常。
- **Hydration**：`hero.spec.ts › public landing hydrates without markup errors` 通过（监听 `pageerror` 与含 `hydration-mismatch` 的 console 错误，结果为空）；axe 扫描 WCAG 2 A/AA + 2.1 AA 无违规。

## 7. 截图

均取自最终构建产物。

| 说明 | 文件 |
| --- | --- |
| 桌面 1440 中文首页 | `docs/screenshots/i18n-first-paint/home-zh-1440.png` |
| 桌面 1440 英文首页 | `docs/screenshots/i18n-first-paint/home-en-1440.png` |
| 手机 390 中文首页 | `docs/screenshots/i18n-first-paint/home-zh-390.png` |
| 手机 390 英文首页 | `docs/screenshots/i18n-first-paint/home-en-390.png` |
| 手机 360 中文首页 | `docs/screenshots/i18n-first-paint/home-zh-360.png` |
| 游戏目录 1440 中文 / 英文 | `play-zh-1440.png` / `play-en-1440.png` |
| 接入页 1440 中文 | `connect-ai-zh-1440.png` |

横向溢出：360 / 390 / 1440 三档 × 中英两语言，`scrollWidth - innerWidth` 均为 **0**。

## 8. 测试命令与真实通过数量

```bash
pnpm lint                                  # 8/8 通过（含 strict type check、design tokens、ai-spec）
pnpm --filter @llmgames/web test           # 11 文件 / 336 用例通过
pnpm --filter @llmgames/web exec playwright test --config playwright.local.config.ts \
  hero.spec.ts locale-switch.spec.ts loading.spec.ts    # 34 passed
pnpm build                                 # web + workers 两任务成功，47 个 JS/CSS 资源
```

扩大扫描（13 个前端相关 spec）：**137 passed / 1 failed**。唯一失败是 `ui-polish.spec.ts › phone Codenames keeps its clue above the board and can expand rosters`，它需要 Durable Objects 后端（本机未启动 workers，`/api/v1/*` 全部 ECONNREFUSED），属于环境限制，与本次改动无关。

**关于 e2e 断言的改动（重要）：** 改动前这 34 个用例是**全部通过**的（我用 `git stash` 取过基线确认）。加入双语节点后有 18 个失败，原因是两类，都不是断言被削弱：

1. `toHaveText` 读的是 `textContent`，双语节点会得到 `"Connect 4Connect 4"` 这样的拼接串 → 改为断言**可见语言节点**（`[data-i18n-text="en"]`）或改用 `innerText` 轮询，断言的是「用户实际看到的语言」，比原来更贴近被测行为。
2. `sr-only` 被拆成两个 span 后，可访问名从 `…Connect 4? ?` 变成 `…Connect 4 ? ?`（多出空格）→ 这是真实的可访问性回归，已在**组件层**修掉（键数组合并成单文本节点），测试保持原样。

没有删除任何断言。

## 9. 残留英文闪烁区域与原因

| 区域 | 原因 | 影响 |
| --- | --- | --- |
| `/watch`、`/games/*`、`/privacy`、`/terms`、`/ai-spec` | 同样是 `client:load` 预渲染孤岛，本次未纳入双语范围 | 中文用户仍会看到约 0.5–1 s 英文首屏 |
| 移动 dock 的 `aria-label` | 桌面/移动是同一渲染分支，可见文案已是双语，但缩写链接的 `aria-label` 只能有一种语言，随 hydration 更新 | 首绘到 hydration 之间，读屏用户听到的简称是英文（视觉无影响） |
| `/play` 加入房间表单 | `placeholder`、`aria-label` 是属性，无法双语 | 输入框占位符首帧为英文 |
| `site.skip`（跳转主内容） | 仅聚焦时可见，未改造 | 键盘用户在 hydration 前聚焦会看到英文 |
| 账号页错误态 | 例如 `无法检查你的账户 / Could not verify your session`，来自运行时接口错误 | 与首屏渲染无关，属既有 i18n 缺口 |
| 棋盘、对局、房间内 | 全部 `client:only`，先渲染加载面板（现已双语）再渲染应用 | 无英文首屏；面板之后的文案本来就按当前语言渲染 |

## 10. 对 SEO、性能与可访问性的影响

**SEO**：无影响。首屏仍是完整的预渲染内容，没有隐藏 `body`/`main`，未增加双 URL 或 hreflang。唯一的语义变化是：`<html lang>` 现在与首屏实际语言一致。

**性能**（生产构建，未压缩 / gzip）：

| 页面 | HTML 改前 | HTML 改后 | 增量 | gzip 增量 |
| --- | --- | --- | --- | --- |
| `/` | 147 487 B | 149 616 B | +2 129 B（+1.44%） | **+379 B**（+0.93%） |
| `/play` | 91 065 B | 91 717 B | +652 B（+0.72%） | **+206 B**（+0.86%） |
| `/connect-ai` | 26 600 B | 27 307 B | +707 B（+2.66%） | — |

FCP 无回归（340→344、248→272，均在 5 次采样的抖动范围内）；JS bundle 增量仅为组件本身（两个纯函数组件，无语义新增依赖）。

**布局**：改前改后逐元素测量完全一致（1440×900）：

```
en-US  h1 500×216@220  subline 398×21@460  actions 433×56@514  hero 1200×666@104  docHeight 5516
zh-CN  h1 500×216@220  subline 399×21@460  actions 356×56@514  hero 1200×666@104  docHeight 5472
```

**可访问性**：隐藏侧为 `display: none`，既不参与布局也不进入可访问树，因此标题、按钮只被朗读一次；可见节点带正确 `lang`；可访问名与改造前逐字一致（`hero.spec.ts` 原断言未改动即通过）；axe WCAG 2 A/AA + 2.1 AA 零违规。

## 11. Commit

- 代码：`38a0589` — *Paint the first screen in the visitor's language*
- 报告与截图：紧随其后的一次提交（本文件）

未部署生产环境。
