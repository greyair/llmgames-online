import { defineConfig } from "@playwright/test";

/**
 * Every existing spec asserts English copy, so the whole suite pins the language
 * before any page script runs. Specs that exercise the switcher opt into another
 * locale explicitly (see e2e/locale-switch.spec.ts).
 */
const ENGLISH_ONLY = {
  cookies: [],
  origins: [
    {
      origin: "http://127.0.0.1:3000",
      localStorage: [{ name: "llmgames-locale", value: "en" }],
    },
  ],
};

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  workers: 4,
  timeout: 30000,
  expect: { timeout: 10000 },
  reporter: [["list"], ["html", { open: "never", outputFolder: "ui-audit-report" }]],
  use: {
    channel: "chromium",
    baseURL: "http://127.0.0.1:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    reducedMotion: "reduce",
    storageState: ENGLISH_ONLY,
  },
  webServer: [
    {
      command: "pnpm dev --host 127.0.0.1 --ignore-lock",
      url: "http://127.0.0.1:3000",
      reuseExistingServer: true,
    },
  ],
});
