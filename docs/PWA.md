# PWA：可安装的 llmgames

- **日期**：2026-11-03
- **范围**：PWA.0（可安装）、PWA.1（缓存/离线/更新）、PWA.2（对局常亮与移动端）
- **不改动**：游戏规则、GamePlugin、MCP、Durable Objects、D1、R2

## 为什么只做「交付层」

llmgames 的对局权威状态在 Cloudflare DO 上：回合、计时、随机结果、私密手牌都在服务端。PWA 能装上，**不等于能离线对局**。所以这一层只做三件事：让它能被安装、让外壳在弱网下说真话、让安装后的窗口更像应用。任何会让人以为「离线也能下棋」的实现都是错的。

## 落地清单

| 能力 | 位置 | 说明 |
| --- | --- | --- |
| `display: standalone` | `public/site.webmanifest` | 安装后独立窗口；另加 `display_override` 支持 Windows 的 window-controls-overlay |
| 图标 | `public/llmgames-icon-192-v3.png` 等 | 沿用现有 192/512/maskable，未另做 |
| iOS/macOS meta | `astro/layouts/BaseLayout.astro` | `apple-mobile-web-app-capable`、状态栏样式 |
| 安装入口 | `src/pwa/InstallApp.tsx` | 站点栏按钮；已安装/独立模式自动隐藏 |
| 安装状态 | `src/pwa/install.ts` | `beforeinstallprompt` 暂存、standalone 检测、平台判定 |
| 安装提示捕获 | `BaseLayout` 内联脚本 | 事件常在 React 之前触发，先落到 `window.__llmgamesPwa` |
| Service Worker | `public/sw.js` | 预缓存离线页；分策略缓存 |
| 更新提示 | `src/pwa/serviceWorker.ts` + `PwaRuntime.tsx` | 新版本就绪时提示，**对局中不重载** |
| 断网提示 | `src/pwa/connectivity.ts` + `PwaRuntime.tsx` | 底部横条 + 恢复提示 |
| 过期行动丢弃 | `src/services/gameSocket.ts` | 队列带时间戳，恢复时丢弃过期动作并提示 |
| 前后台恢复 | `src/services/gameSocket.ts` | `visibilitychange` / `online` 立即重连，不等退避 |
| 对局常亮 | `src/pwa/useWakeLock.ts` | 仅 `status !== ended` 时申请 Screen Wake Lock |

## 缓存策略

| 资源 | 策略 | 原因 |
| --- | --- | --- |
| `/_astro/*`（带哈希） | Cache First | 文件名即版本，永不冲突 |
| 图片（`/pokemon/*`、图标） | Stale-While-Revalidate + 上限 400 | 755 张精灵图不能全预缓存 |
| 公共页面 HTML | Network First → 缓存 → `/offline.html` | 优先新页面，断网有交代 |
| `/room`、`/series` | Network Only → `/offline.html` | 缓存的房间壳会伪装成「已连接」 |
| `/api/*`、`/.well-known/*` | 不缓存 | 状态、鉴权、MCP 必须来自服务器 |
| 非 GET、跨域 | 不拦截 | 同上 |
| `/sw.js` | 不缓存（`_headers` 里 `no-store`） | 否则更新永远到不了 |

图片缓存做了简单的 FIFO 裁剪（超过 400 张删最旧的），避免长期使用后无限增长。

## 更新策略

1. 新 SW 安装完成后**不会**自动 `skipWaiting`，因此不会把正在对局的人换到新前端。
2. 页面收到 `updatefound` 且已有 controller 时，标记「有新版本」。
3. 提示分两种：
   - 不在对局：显示「立即更新 / 稍后」，点立即 → `SKIP_WAITING` → `controllerchange` → 重载一次。
   - 在对局：只提示「请先打完这一局」，**不提供按钮**。`matchGuard` 由 `Room` 挂载时持有，离开房间释放。
4. 首次安装（无 controller）不弹提示。

## 断网与恢复

- `navigator.onLine` 只是提示，真正连接状态由 socket 决定；它只用来**拦住提交**和解释「为什么按了没反应」。
- 断网时 `send()` 直接拒绝并提示，不再把动作塞进队列。
- 已经进队的动作带时间戳：恢复时超过 8 秒的动作**丢弃**并提示（聊天 60 秒）。避免「五分钟前的一步棋」在恢复瞬间替玩家走掉。
- 回到前台或重新联网时，重置退避、立刻重连；聊天游标由 `Room` 在重连后补拉。

## 安装入口矩阵

| 平台 | 表现 |
| --- | --- |
| Windows / Android Chrome、Edge | 有 `beforeinstallprompt` 时点一下走原生确认 |
| 同上但事件缺失 | 弹指引：地址栏安装图标 / 浏览器菜单 |
| iPhone / iPad | 指引：分享 → 添加到主屏幕 |
| macOS Safari | 指引：文件 → 添加到程序坞 |
| Firefox 等 | 不渲染入口（不提供死按钮） |
| 已安装 / standalone 窗口 | 入口消失 |

## 测试

```bash
pnpm --filter @llmgames/web test        # 平台判定等单元用例
pnpm --filter @llmgames/web exec playwright test e2e/pwa.spec.ts
pnpm --filter @llmgames/web build
pnpm --filter @llmgames/web preview    # 产物预览：SW 只在这里注册
```

需要人工过一遍的场景（自动化只覆盖到外壳）：

1. **斗地主切后台再回来**：计时是否继续、聊天游标是否补上、能不能正常出牌。
2. **对局中发布新版本**：应只看到「请先打完这一局」，离开房间后才提示更新。
3. **Wi-Fi 切移动网络**：断网横条出现，操作被拒；恢复后能继续。
4. **重启已安装应用**：回到 `/play`，登录态保持。
5. **网页版与安装版进同一房间**：两端都能正常对局与聊天。

## 刻意没做

- **Web Push / 图标角标**：需要 VAPID 与后端推送管线，且 iOS 只在「已安装」形态下支持。属于下一阶段。
- **应用商店上架**：PWA 稳定后再评估，不引入额外封装。
- **离线对局**：服务端权威，做不到也不该假装做到。
- **首访安装弹窗**：只在站点栏放常驻入口，不打断第一次访问。

## 已知取舍

- 开发环境不注册 SW（`import.meta.env.DEV` 直接返回），否则 Vite 的未哈希 HTML 会被缓存，改代码看不到效果。
- `/offline.html` 是纯 HTML + 内联样式，不依赖应用 bundle：断网时它必须能从缓存里独立渲染。
- 站点栏的安装按钮在 ≤1080px 收成图标，避免挤压导航。
