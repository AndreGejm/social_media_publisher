import { expect, vi } from "vitest";

export type UiSignalPattern = string | RegExp;

type UiSignalSnapshot = {
  errors: string[];
  warnings: string[];
  alerts: string[];
  statuses: string[];
  dialogs: string[];
  modalErrors: string[];
};

export type UiSignalRecorder = {
  expectClean: (options?: {
    allowAlerts?: UiSignalPattern[];
    allowStatuses?: UiSignalPattern[];
    allowDialogs?: UiSignalPattern[];
    allowModalErrors?: UiSignalPattern[];
    includeWarnings?: boolean;
  }) => void;
  snapshot: () => UiSignalSnapshot;
  restore: () => void;
};

function formatMessage(args: unknown[]): string {
  return args
    .map((value) => {
      if (typeof value === "string") return value;
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    })
    .join(" ")
    .trim();
}

function matchesPattern(value: string, patterns: UiSignalPattern[]): boolean {
  if (patterns.length === 0) {
    return false;
  }

  return patterns.some((pattern) =>
    typeof pattern === "string" ? value.includes(pattern) : pattern.test(value)
  );
}

function isVisibleElement(element: Element): element is HTMLElement {
  if (!(element instanceof HTMLElement)) {
    return false;
  }

  if (element.hidden || element.closest("[hidden], [aria-hidden='true']")) {
    return false;
  }

  const style = window.getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden";
}

function collectRoleText(role: "alert" | "status" | "dialog"): string[] {
  return Array.from(document.querySelectorAll(`[role="${role}"]`))
    .filter(isVisibleElement)
    .map((element) => element.textContent?.replace(/\s+/g, " ").trim() ?? "")
    .filter((text) => text.length > 0);
}

function collectModalErrors(dialogs: string[]): string[] {
  return dialogs.filter((text) => /\b(error|failed|failure|unable|invalid)\b/i.test(text));
}

export function createUiSignalRecorder(options?: {
  ignoreConsole?: UiSignalPattern[];
  ignoreWarnings?: UiSignalPattern[];
}): UiSignalRecorder {
  const errors: string[] = [];
  const warnings: string[] = [];
  const ignoreConsole = options?.ignoreConsole ?? [];
  const ignoreWarnings = options?.ignoreWarnings ?? [];

  const errorSpy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    const message = formatMessage(args);
    if (matchesPattern(message, ignoreConsole)) {
      return;
    }
    errors.push(message);
  });

  const warnSpy = vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
    const message = formatMessage(args);
    if (matchesPattern(message, ignoreWarnings)) {
      return;
    }
    warnings.push(message);
  });

  return {
    expectClean({
      allowAlerts = [],
      allowStatuses = [],
      allowDialogs = [],
      allowModalErrors = [],
      includeWarnings = true
    } = {}) {
      const alerts = collectRoleText("alert").filter((text) => !matchesPattern(text, allowAlerts));
      const statuses = collectRoleText("status").filter((text) => !matchesPattern(text, allowStatuses));
      const dialogs = collectRoleText("dialog").filter((text) => !matchesPattern(text, allowDialogs));
      const modalErrors = collectModalErrors(collectRoleText("dialog")).filter(
        (text) => !matchesPattern(text, allowModalErrors)
      );

      expect(errors, `Unexpected console.error output:\n${errors.join("\n")}`).toEqual([]);
      if (includeWarnings) {
        expect(warnings, `Unexpected console.warn output:\n${warnings.join("\n")}`).toEqual([]);
      }
      expect(alerts, `Unexpected alert banners:\n${alerts.join("\n")}`).toEqual([]);
      expect(statuses, `Unexpected status banners:\n${statuses.join("\n")}`).toEqual([]);
      expect(dialogs, `Unexpected dialogs:\n${dialogs.join("\n")}`).toEqual([]);
      expect(modalErrors, `Unexpected modal errors:\n${modalErrors.join("\n")}`).toEqual([]);
    },
    snapshot() {
      const dialogs = collectRoleText("dialog");
      return {
        errors: [...errors],
        warnings: [...warnings],
        alerts: collectRoleText("alert"),
        statuses: collectRoleText("status"),
        dialogs,
        modalErrors: collectModalErrors(dialogs)
      };
    },
    restore() {
      errorSpy.mockRestore();
      warnSpy.mockRestore();
    }
  };
}
