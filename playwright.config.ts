import path from "node:path";

import { defineConfig } from "@playwright/test";

const pnpmBin = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const pathSeparator = process.platform === "win32" ? ";" : ":";
const corepackShimDir = path.join(
  path.dirname(process.execPath),
  "node_modules",
  "corepack",
  "shims"
);
const playwrightPath = [corepackShimDir, process.env.PATH ?? ""]
  .filter((entry) => entry.length > 0)
  .join(pathSeparator);

process.env.PATH = playwrightPath;

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
    env: {
      ...process.env,
      PATH: playwrightPath
    },
    port: 4173,
    reuseExistingServer: true,
    timeout: 120_000
  }
});


