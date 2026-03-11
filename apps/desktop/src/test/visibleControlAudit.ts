import { fireEvent, screen, within } from "@testing-library/react";
import { expect } from "vitest";

const DEFAULT_AUDIT_ROLES = [
  "button",
  "checkbox",
  "combobox",
  "radio",
  "searchbox",
  "slider",
  "spinbutton",
  "switch",
  "tab",
  "textbox"
] as const;

export type VisibleControlAuditItem = {
  role: string;
  name: string | RegExp;
  expectation: "action" | "disabled" | "noop";
  rationale?: string;
  act?: (element: HTMLElement) => void | Promise<void>;
  assertAfter?: () => void | Promise<void>;
};

export type EnumeratedVisibleControl = {
  role: string;
  name: string;
};

type EnumeratedVisibleControlDetail = EnumeratedVisibleControl & {
  element: HTMLElement;
};

type VisibleControlAuditOptions = {
  root?: HTMLElement;
  includeRoles?: readonly string[];
};

function normalizeText(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
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

function extractLabelText(label: HTMLLabelElement): string {
  const clone = label.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("input, select, textarea, button").forEach((control) => control.remove());
  return normalizeText(clone.textContent);
}

function contextualizeGenericName(element: HTMLElement, baseName: string): string {
  if (baseName === "Clear") {
    const shortcutRow = element.closest(".settings-shortcut-row");
    if (shortcutRow instanceof HTMLElement) {
      const shortcutLabel = normalizeText(
        shortcutRow.querySelector(".settings-shortcut-meta strong")?.textContent
      );
      if (shortcutLabel) {
        return `Clear ${shortcutLabel} shortcut`;
      }
    }

    const mediaCard = element.closest(".video-media-card");
    if (mediaCard instanceof HTMLElement) {
      const mediaLabel = normalizeText(mediaCard.querySelector("h5")?.textContent);
      if (mediaLabel) {
        return `Clear ${mediaLabel}`;
      }
    }
  }

  if (baseName === "Dismiss") {
    const notification = element.closest(".app-notification");
    if (notification instanceof HTMLElement) {
      const notificationLabel = normalizeText(
        notification.querySelector(".app-notification-label")?.textContent
      );
      if (notificationLabel) {
        return `Dismiss ${notificationLabel}`;
      }
    }
  }

  return baseName;
}

function normalizeName(element: HTMLElement): string {
  const ariaLabel = normalizeText(element.getAttribute("aria-label"));
  if (ariaLabel) {
    return ariaLabel;
  }

  const labelledBy = normalizeText(element.getAttribute("aria-labelledby"));
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => normalizeText(document.getElementById(id)?.textContent))
      .filter(Boolean)
      .join(" ");
    if (text) {
      return text;
    }
  }

  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLSelectElement ||
    element instanceof HTMLTextAreaElement
  ) {
    if (element.id) {
      const explicitLabel = Array.from(document.querySelectorAll("label")).find(
        (label): label is HTMLLabelElement =>
          label instanceof HTMLLabelElement && label.htmlFor === element.id
      );
      if (explicitLabel) {
        const text = extractLabelText(explicitLabel);
        if (text) {
          return text;
        }
      }
    }

    const wrappingLabel = element.closest("label");
    if (wrappingLabel instanceof HTMLLabelElement) {
      const text = extractLabelText(wrappingLabel);
      if (text) {
        return text;
      }
    }
  }

  const textContent = normalizeText(element.textContent);
  if (textContent.length > 0) {
    return contextualizeGenericName(element, textContent);
  }

  return "<unnamed>";
}

function matchesControl(contract: VisibleControlAuditItem, control: EnumeratedVisibleControl): boolean {
  if (contract.role !== control.role) {
    return false;
  }

  return typeof contract.name === "string"
    ? contract.name === control.name
    : contract.name.test(control.name);
}

function formatControl(control: EnumeratedVisibleControl): string {
  return `${control.role}: ${control.name}`;
}

function collectVisibleControls(options?: VisibleControlAuditOptions): EnumeratedVisibleControlDetail[] {
  const scope = options?.root ? within(options.root) : screen;
  const includeRoles = options?.includeRoles ?? DEFAULT_AUDIT_ROLES;
  const controls: EnumeratedVisibleControlDetail[] = [];

  includeRoles.forEach((role) => {
    scope
      .queryAllByRole(role as never)
      .filter(isVisibleElement)
      .forEach((element) => {
        controls.push({
          role,
          name: normalizeName(element),
          element
        });
      });
  });

  return controls.sort(
    (left, right) => left.role.localeCompare(right.role) || left.name.localeCompare(right.name)
  );
}

export function enumerateVisibleControls(options?: VisibleControlAuditOptions): EnumeratedVisibleControl[] {
  const deduped = new Map<string, EnumeratedVisibleControl>();

  collectVisibleControls(options).forEach((control) => {
    deduped.set(`${control.role}::${control.name}`, {
      role: control.role,
      name: control.name
    });
  });

  return Array.from(deduped.values());
}

export async function assertVisibleActionableControls(
  controls: readonly VisibleControlAuditItem[],
  scopeLabel: string,
  options?: VisibleControlAuditOptions
): Promise<void> {
  const discoveredControls = collectVisibleControls(options);
  const uncoveredControls = discoveredControls.filter(
    (control) => !controls.some((contract) => matchesControl(contract, control))
  );

  expect(
    [...new Set(uncoveredControls.map(formatControl))],
    `${scopeLabel}: every visible actionable control in scope needs an explicit contract`
  ).toEqual([]);

  const remainingControls = [...discoveredControls];

  for (const control of controls) {
    const controlIndex = remainingControls.findIndex((candidate) => matchesControl(control, candidate));
    expect(controlIndex, `${scopeLabel}: missing ${control.role} ${String(control.name)}`).toBeGreaterThan(-1);

    const [matchedControl] = remainingControls.splice(controlIndex, 1);
    const element = matchedControl.element;
    expect(element, `${scopeLabel}: missing ${control.role} ${String(control.name)}`).toBeVisible();

    if (control.expectation === "disabled") {
      expect(element, `${scopeLabel}: ${matchedControl.name} should be disabled`).toBeDisabled();
      continue;
    }

    if (control.expectation === "noop") {
      expect(
        control.rationale?.trim().length ?? 0,
        `${scopeLabel}: ${matchedControl.name} needs a no-op rationale`
      ).toBeGreaterThan(0);
      continue;
    }

    expect(element, `${scopeLabel}: ${matchedControl.name} should be enabled`).not.toBeDisabled();
    if (control.act) {
      await control.act(element);
    } else {
      fireEvent.click(element);
    }
    if (control.assertAfter) {
      await control.assertAfter();
    }
  }
}
