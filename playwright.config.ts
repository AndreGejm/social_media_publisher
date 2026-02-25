import { defineConfig } from "@playwright/test";

const pnpmBin = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

export default defineConfig({
  testDir: "./playwright/tests",
  fullyParallel: true,
  timeout: 30_000,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "on-first-retry"
  },
  webServer: {
    command: `${pnpmBin} --filter @release-publisher/desktop build && ${pnpmBin} --filter @release-publisher/desktop preview --host 127.0.0.1`,
    port: 4173,
    reuseExistingServer: true,
    timeout: 120_000
  }
});
