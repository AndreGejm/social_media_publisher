import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

type TauriPatternConfig =
  | { use: "brownfield" }
  | { use: "isolation"; options: { dir: string } };

type TauriConfig = {
  app?: {
    windows?: Array<{ label?: string }>;
    security?: {
      csp?: string | null;
      devCsp?: string | null;
      freezePrototype?: boolean;
      dangerousDisableAssetCspModification?: boolean | string[] | null;
      capabilities?: string[];
      assetProtocol?: { enable?: boolean; scope?: string[] };
      pattern?: TauriPatternConfig;
    };
  };
};

type CapabilityFile = {
  identifier: string;
  description?: string;
  local?: boolean;
  remote?: unknown;
  windows?: string[];
  webviews?: string[];
  permissions: string[];
};

type PackageJson = {
  dependencies?: Record<string, unknown>;
  devDependencies?: Record<string, unknown>;
};

function desktopPath(...parts: string[]): string {
  return path.resolve(process.cwd(), ...parts);
}

function readJsonFile<T>(filePath: string): T {
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw) as T;
}

function loadTauriConfig(): TauriConfig {
  return readJsonFile<TauriConfig>(desktopPath("src-tauri", "tauri.conf.json"));
}

function loadDefaultCapability(): CapabilityFile {
  return readJsonFile<CapabilityFile>(desktopPath("src-tauri", "capabilities", "default.json"));
}

function loadPackageJson(): PackageJson {
  return readJsonFile<PackageJson>(desktopPath("package.json"));
}

function loadDesktopCargoTomlText(): string {
  return fs.readFileSync(desktopPath("src-tauri", "Cargo.toml"), "utf8");
}

function loadAppAclDefaultTomlText(): string {
  return fs.readFileSync(desktopPath("src-tauri", "permissions", "default.toml"), "utf8");
}

function parseCsp(policy: string): Map<string, string[]> {
  const directives = new Map<string, string[]>();
  for (const chunk of policy.split(";")) {
    const trimmed = chunk.trim();
    if (!trimmed) continue;
    const [name, ...values] = trimmed.split(/\s+/);
    directives.set(name, values);
  }
  return directives;
}

function directive(policy: string, name: string): string[] {
  return parseCsp(policy).get(name) ?? [];
}

function expectContainsAll(actual: string[], expected: string[]) {
  for (const token of expected) {
    expect(actual).toContain(token);
  }
}

function expectNoBroadWildcardSources(csp: string) {
  const tokens = csp
    .split(/[;\s]+/)
    .map((token) => token.trim())
    .filter(Boolean);

  for (const token of tokens) {
    if (!token.includes("*")) continue;
    expect(false, `wildcard token must not be present in strict CSP: ${token}`).toBe(true);
  }
}

function containsAny(text: string, values: string[]): boolean {
  return values.some((value) => text.includes(value));
}

describe("Tauri security config", () => {
  it("enables explicit security controls and Tauri Isolation Pattern", () => {
    const config = loadTauriConfig();
    const security = config.app?.security;

    expect(config.app?.windows?.[0]?.label).toBe("main");
    expect(security?.freezePrototype).toBe(true);
    expect(security?.dangerousDisableAssetCspModification).toBe(false);
    expect(security?.capabilities).toEqual(["default"]);
    expect(security?.assetProtocol?.enable).toBe(true);
    expect(security?.assetProtocol?.scope).toEqual([
      "$APPDATA/**",
      "$APPLOCALDATA/**",
      "$APPCACHE/**",
      "$DOCUMENT/**",
      "$DOWNLOAD/**",
      "$AUDIO/**",
      "$HOME/Music/**"
    ]);
    expect(security?.pattern?.use).toBe("isolation");
    if (security?.pattern?.use === "isolation") {
      expect(security.pattern.options.dir).toBe("isolation");
    }
  });

  it("defines a strict production CSP without unsafe-eval or broad wildcards", () => {
    const config = loadTauriConfig();
    const csp = config.app?.security?.csp;

    expect(typeof csp).toBe("string");
    expect(csp).toBeTruthy();
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("form-action 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("worker-src 'none'");
    expect(csp).not.toContain("unsafe-eval");

    expectNoBroadWildcardSources(csp as string);

    expectContainsAll(directive(csp as string, "frame-src"), ["'self'"]);
    expectContainsAll(directive(csp as string, "connect-src"), [
      "'self'",
      "ipc:",
      "http://ipc.localhost"
    ]);
  });

  it("uses a dev-only CSP for localhost/Vite allowances", () => {
    const config = loadTauriConfig();
    const prod = config.app?.security?.csp;
    const dev = config.app?.security?.devCsp;

    expect(typeof prod).toBe("string");
    expect(typeof dev).toBe("string");
    expect(dev).not.toBe(prod);
    expect(dev).toContain("http://localhost:1420");
    expect(dev).toContain("ws://localhost:1420");
    expect(dev).not.toContain("unsafe-eval");
  });

  it("pins the capability to the local main window and avoids dangerous plugin permissions", () => {
    const capability = loadDefaultCapability();
    const appAclDefault = loadAppAclDefaultTomlText();

    expect(capability.identifier).toBe("default");
    expect(capability.local === undefined || capability.local === true).toBe(true);
    expect(capability.remote).toBeUndefined();
    expect(capability.windows).toEqual(["main"]);
    expect(capability.webviews).toBeUndefined();
    expect(capability.permissions).toEqual(["default", "dialog:allow-open"]);
    expect(capability.permissions).not.toContain("core:default");

    expect(appAclDefault).toContain("[default]");
    expect(appAclDefault).toContain("allow-load-spec");
    expect(appAclDefault).toContain("allow-plan-release");
    expect(appAclDefault).toContain("allow-execute-release");
    expect(appAclDefault).toContain("allow-list-history");
    expect(appAclDefault).toContain("allow-get-report");
    expect(appAclDefault).toContain("allow-analyze-audio-file");
    expect(appAclDefault).toContain("allow-analyze-and-persist-release-track");
    expect(appAclDefault).toContain("allow-get-release-track-analysis");

    for (const label of capability.windows ?? []) {
      expect(label.includes("*")).toBe(false);
    }

    expect(capability.permissions).toContain("dialog:allow-open");
    expect(
      capability.permissions.some((permission) =>
        /^(shell|fs|http|opener|cli|process):/i.test(permission)
      )
    ).toBe(false);
  });

  it("does not include dangerous Tauri plugins in Rust or web dependencies", () => {
    const cargoTomlText = loadDesktopCargoTomlText();
    const packageJsonText = JSON.stringify(loadPackageJson());

    expect(
      containsAny(cargoTomlText, [
        "tauri-plugin-shell",
        "tauri-plugin-fs",
        "tauri-plugin-http",
        "tauri-plugin-opener",
        "tauri-plugin-cli"
      ])
    ).toBe(false);

    expect(cargoTomlText).toContain("tauri-plugin-dialog");

    expect(
      containsAny(packageJsonText, [
        "@tauri-apps/plugin-shell",
        "@tauri-apps/plugin-fs",
        "@tauri-apps/plugin-http",
        "@tauri-apps/plugin-opener"
      ])
    ).toBe(false);

    expect(packageJsonText).toContain("@tauri-apps/plugin-dialog");
  });

  it("ships a dedicated isolation app stub that sets __TAURI_ISOLATION_HOOK__", () => {
    const isolationIndex = fs.readFileSync(
      desktopPath("src-tauri", "isolation", "index.html"),
      "utf8"
    );
    expect(isolationIndex).toContain("__TAURI_ISOLATION_HOOK__");
  });
});
