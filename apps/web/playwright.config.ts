import { defineConfig } from "@playwright/test";

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
  },
  webServer: [
    {
      command: "pnpm dev --host 127.0.0.1 --ignore-lock",
      url: "http://127.0.0.1:3000",
      reuseExistingServer: true,
    },
  ],
});
