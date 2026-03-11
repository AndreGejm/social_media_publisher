import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./playwright/runtime",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report-runtime" }]],
  use: {
    trace: "on-first-retry"
  }
});


