import type { UiAppError } from "./types";

export const MAX_IPC_PATH_CHARS = 4096;

export function invalidArgument(message: string, details?: unknown): UiAppError {
  return {
    code: "INVALID_ARGUMENT",
    message,
    details
  };
}

export function assertFiniteNumber(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw invalidArgument(`${label} must be a finite number.`);
  }
}

export function assertInteger(value: number, label: string): void {
  assertFiniteNumber(value, label);
  if (!Number.isInteger(value)) {
    throw invalidArgument(`${label} must be an integer.`);
  }
}

export function assertString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string") {
    throw invalidArgument(`${label} must be a string.`);
  }
}

export function assertStringWithMaxLength(value: string, label: string, maxLength: number): void {
  if (value.length > maxLength) {
    throw invalidArgument(`${label} exceeds maximum length of ${maxLength} characters.`);
  }
}

export function assertNonEmptyString(value: string, label: string): void {
  if (value.trim().length === 0) {
    throw invalidArgument(`${label} cannot be empty.`);
  }
}

export function assertPath(value: unknown, label: string): string {
  assertString(value, label);
  assertNonEmptyString(value, label);
  assertStringWithMaxLength(value, label, MAX_IPC_PATH_CHARS);
  return value;
}

export function assertHexId(value: unknown, label: string): string {
  assertString(value, label);
  const normalized = value.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw invalidArgument(`${label} must be a 64-character hex string.`);
  }
  return normalized;
}

export function assertQcProfileId(value: unknown, label: string): string {
  assertString(value, label);
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z0-9_-]+$/.test(normalized)) {
    throw invalidArgument(`${label} must contain only a-z, 0-9, '_' or '-'.`);
  }
  return normalized;
}
