import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

type TauriConfig = {
  app?: {
    security?: {
      csp?: string | null;
    };
  };
};

function loadTauriConfig(): TauriConfig {
  const configPath = path.resolve(process.cwd(), "src-tauri", "tauri.conf.json");
  const raw = fs.readFileSync(configPath, "utf8");
  return JSON.parse(raw) as TauriConfig;
}

describe("Tauri security config", () => {
  it("defines a non-null CSP baseline without unsafe-eval or wildcard sources", () => {
    const config = loadTauriConfig();
    const csp = config.app?.security?.csp;

    expect(typeof csp).toBe("string");
    expect(csp).toBeTruthy();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toContain("*");
  });
});
