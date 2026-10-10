import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "series.spec.ts",
  workers: 1,
  timeout: 60000,
  expect: { timeout: 15000 },
  use: {
    channel: "chromium",
    baseURL: "http://127.0.0.1:3000",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    reducedMotion: "reduce",
  },
  reporter: "list",
  webServer: [
    {
      command: "pnpm dev --host 127.0.0.1 --ignore-lock",
      url: "http://127.0.0.1:3000",
      reuseExistingServer: true,
    },
    {
      command: "pnpm --filter @llmgames/workers dev",
      url: "http://localhost:6787/health",
      reuseExistingServer: true,
    },
  ],
});
