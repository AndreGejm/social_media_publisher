import { expect, type Page } from "@playwright/test";

type UiSignalMonitor = {
  assertClean: (
    label: string,
    options?: { allowedNotifications?: Array<RegExp | string> }
  ) => Promise<void>;
};

const NOTIFICATION_LOCATOR = '[aria-label="Notifications"] .app-notification';

function matchesAllowedNotification(
  text: string,
  allowedNotifications: Array<RegExp | string>
): boolean {
  return allowedNotifications.some((allowed) =>
    typeof allowed === "string" ? text.includes(allowed) : allowed.test(text)
  );
}

export function attachUiSignalMonitor(page: Page): UiSignalMonitor {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const dialogs: string[] = [];

  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });
  page.on("dialog", (dialog) => {
    dialogs.push(`${dialog.type()}: ${dialog.message()}`);
    void dialog.dismiss().catch(() => undefined);
  });

  return {
    async assertClean(label, options) {
      const allowedNotifications = options?.allowedNotifications ?? [];
      const notificationTexts = (await page.locator(NOTIFICATION_LOCATOR).allInnerTexts())
        .map((text) => text.replace(/\s+/g, " ").trim())
        .filter(Boolean);
      const unexpectedNotifications = notificationTexts.filter(
        (text) => !matchesAllowedNotification(text, allowedNotifications)
      );

      expect(consoleErrors, `${label}: unexpected console errors`).toEqual([]);
      expect(pageErrors, `${label}: unexpected page errors`).toEqual([]);
      expect(dialogs, `${label}: unexpected dialogs`).toEqual([]);
      expect(unexpectedNotifications, `${label}: unexpected notifications`).toEqual([]);
    }
  };
}

export async function gotoCurrentShell(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByRole("tablist", { name: "Application mode" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Workspaces" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Shared transport" })).toBeVisible();
}

export async function openWorkspace(page: Page, name: string): Promise<void> {
  if (name === "Video Workspace") {
    await page.getByRole("tab", { name: "Video Rendering" }).click();
    return;
  }

  await page
    .getByRole("navigation", { name: "Workspaces" })
    .getByRole("button", { name })
    .click();
}

export async function openApplicationMode(
  page: Page,
  name: "Release Preview" | "Publish"
): Promise<void> {
  await page.getByRole("tab", { name }).click();
}

export async function expectNoHorizontalOverflow(
  page: Page,
  label: string
): Promise<void> {
  const metrics = await page.evaluate(() => ({
    documentScrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
    innerWidth: window.innerWidth
  }));

  expect(
    metrics.documentScrollWidth,
    `${label}: document scroll width should fit the viewport`
  ).toBeLessThanOrEqual(metrics.innerWidth + 1);
  expect(
    metrics.bodyScrollWidth,
    `${label}: body scroll width should fit the viewport`
  ).toBeLessThanOrEqual(metrics.innerWidth + 1);
}

export async function readShellGeometry(page: Page): Promise<{
  hasRightDockClass: boolean;
  mainRect: { x: number; y: number; width: number; height: number } | null;
  dockRect: { x: number; y: number; width: number; height: number } | null;
}> {
  return page.evaluate(() => {
    const shell = document.querySelector(".music-shell");
    const main = document.querySelector(".music-main");
    const dock = document.querySelector(".music-right-dock");
    const toRect = (element: Element | null) => {
      if (!(element instanceof HTMLElement)) return null;
      const rect = element.getBoundingClientRect();
      return {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height
      };
    };

    return {
      hasRightDockClass: shell?.classList.contains("with-right-dock") ?? false,
      mainRect: toRect(main),
      dockRect: toRect(dock)
    };
  });
}

export async function invokeTauriCommand<T>(
  page: Page,
  command: string,
  args?: Record<string, unknown>
): Promise<T> {
  return page.evaluate(
    async ({ nextCommand, nextArgs }) => {
      const invoke = (window as Window & {
        __TAURI_INTERNALS__?: {
          invoke?: (
            commandName: string,
            invokeArgs?: Record<string, unknown>,
            options?: unknown
          ) => Promise<unknown>;
        };
      }).__TAURI_INTERNALS__?.invoke;

      if (typeof invoke !== "function") {
        throw new Error("Tauri invoke is unavailable in this runtime.");
      }

      return (await invoke(nextCommand, nextArgs, undefined)) as T;
    },
    {
      nextCommand: command,
      nextArgs: args ?? {}
    }
  );
}