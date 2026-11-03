import { describe, expect, it } from "vitest";

import { detectPlatform, detectStandalone, offersInstall } from "../../src/pwa/install";

/**
 * Installability is a platform question, not a code question: the same markup
 * has to become a native prompt on Chromium, a menu walkthrough on Safari, and
 * nothing at all on browsers that cannot install. These cases pin that mapping.
 */

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";

const IPAD_DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";

const MAC_SAFARI =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";

const CHROME_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const EDGE_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0";

const CHROME_ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";

const FIREFOX =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0";

describe("安装平台判定", () => {
  it("iPhone 与 iPad 都走「添加到主屏幕」", () => {
    expect(detectPlatform({ userAgent: IPHONE, platform: "iPhone" })).toBe("ios");

    // iPadOS 13+ 报告桌面 UA，只能靠触点数量区分 iPad 和 MacBook。
    expect(
      detectPlatform({ userAgent: IPAD_DESKTOP_UA, platform: "MacIntel", maxTouchPoints: 5 }),
    ).toBe("ios");

    expect(detectPlatform({ userAgent: IPAD_DESKTOP_UA, platform: "MacIntel", maxTouchPoints: 0 })).toBe(
      "macos-safari",
    );
  });

  it("Chromium 内核走原生安装提示", () => {
    expect(detectPlatform({ userAgent: CHROME_WINDOWS })).toBe("chromium");
    expect(detectPlatform({ userAgent: EDGE_WINDOWS })).toBe("chromium");
    expect(detectPlatform({ userAgent: CHROME_ANDROID })).toBe("chromium");
  });

  it("macOS Safari 走「添加到程序坞」", () => {
    expect(detectPlatform({ userAgent: MAC_SAFARI })).toBe("macos-safari");
  });

  it("无法安装的浏览器不会被当成可安装", () => {
    expect(detectPlatform({ userAgent: FIREFOX })).toBe("unsupported");
    expect(offersInstall(detectPlatform({ userAgent: FIREFOX }))).toBe(false);
  });
});

describe("独立窗口判定", () => {
  it("standalone / window-controls-overlay 都算已安装", () => {
    expect(detectStandalone({ displayModes: ["standalone"] })).toBe(true);
    expect(detectStandalone({ displayModes: ["window-controls-overlay"] })).toBe(true);
    expect(detectStandalone({ displayModes: ["browser"] })).toBe(false);
  });

  it("iOS 主屏幕用 navigator.standalone 表示", () => {
    expect(detectStandalone({ displayModes: [], navigatorStandalone: true })).toBe(true);
    expect(detectStandalone({ displayModes: [], navigatorStandalone: false })).toBe(false);
  });
});

describe("是否给出安装入口", () => {
  it("Chromium 即使没收到事件也要给入口", () => {
    // 事件缺失只说明 Chrome 不弹窗，地址栏的安装图标仍然是有效路径。
    expect(offersInstall("chromium")).toBe(true);
  });

  it("iOS 与 macOS Safari 给指引", () => {
    expect(offersInstall("ios")).toBe(true);
    expect(offersInstall("macos-safari")).toBe(true);
  });

  it("不支持的平台不渲染按钮", () => {
    expect(offersInstall("unsupported")).toBe(false);
  });
});
