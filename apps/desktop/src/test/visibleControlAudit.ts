import { fireEvent, screen, within } from "@testing-library/react";
import { expect } from "vitest";

const DEFAULT_AUDIT_ROLES = [
  "button",
  "checkbox",
  "combobox",
  "radio",
  "searchbox",
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
        (label): label is HTMLLabelElement => label instanceof HTMLLabelElement && label.htmlFor === element.id
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
  return textContent.length > 0 ? textContent : "<unnamed>";
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

export function enumerateVisibleControls(options?: VisibleControlAuditOptions): EnumeratedVisibleControl[] {
  const scope = options?.root ? within(options.root) : screen;
  const includeRoles = options?.includeRoles ?? DEFAULT_AUDIT_ROLES;
  const deduped = new Map<string, EnumeratedVisibleControl>();

  includeRoles.forEach((role) => {
    scope
      .queryAllByRole(role as never)
      .filter(isVisibleElement)
      .forEach((element) => {
        const control = { role, name: normalizeName(element) };
        deduped.set(`${control.role}::${control.name}`, control);
      });
  });

  return Array.from(deduped.values()).sort(
    (left, right) => left.role.localeCompare(right.role) || left.name.localeCompare(right.name)
  );
}

export async function assertVisibleActionableControls(
  controls: readonly VisibleControlAuditItem[],
  scopeLabel: string,
  options?: VisibleControlAuditOptions
): Promise<void> {
  const discoveredControls = enumerateVisibleControls(options);
  const uncoveredControls = discoveredControls.filter(
    (control) => !controls.some((contract) => matchesControl(contract, control))
  );

  expect(
    uncoveredControls.map(formatControl),
    `${scopeLabel}: every visible actionable control in scope needs an explicit contract`
  ).toEqual([]);

  const scope = options?.root ? within(options.root) : screen;

  for (const control of controls) {
    const element = scope.getByRole(control.role as never, { name: control.name as never }) as HTMLElement;
    expect(element, `${scopeLabel}: missing ${control.role} ${String(control.name)}`).toBeVisible();

    if (control.expectation === "disabled") {
      expect(element, `${scopeLabel}: ${String(control.name)} should be disabled`).toBeDisabled();
      continue;
    }

    if (control.expectation === "noop") {
      expect(
        control.rationale?.trim().length ?? 0,
        `${scopeLabel}: ${String(control.name)} needs a no-op rationale`
      ).toBeGreaterThan(0);
      continue;
    }

    expect(element, `${scopeLabel}: ${String(control.name)} should be enabled`).not.toBeDisabled();
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
