const MAX_DEFAULT_TEXT_CHARS = 256;

function isUnsafeDisplayCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x00 && codePoint <= 0x1f) ||
    codePoint === 0x7f ||
    (codePoint >= 0x202a && codePoint <= 0x202e) ||
    (codePoint >= 0x2066 && codePoint <= 0x2069)
  );
}

/**
 * Normalizes untrusted UI text from IPC/backend before rendering.
 */
export function sanitizeUiText(raw: string, maxChars = MAX_DEFAULT_TEXT_CHARS): string {
  let filtered = "";
  for (const char of raw) {
    const codePoint = char.codePointAt(0);
    if (codePoint == null || isUnsafeDisplayCodePoint(codePoint)) {
      filtered += " ";
      continue;
    }
    filtered += char;
  }

  const cleaned = filtered.replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  if (cleaned.length <= maxChars) return cleaned;
  return `${cleaned.slice(0, maxChars)}...`;
}

/**
 * Sanitizes an unknown UI-facing error to avoid leaking internals.
 */
export function sanitizeUiErrorMessage(
  error: unknown,
  fallback: string
): string {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const safe = sanitizeUiText(message, 200);
  if (!safe) return fallback;

  const lower = safe.toLowerCase();
  if (
    lower.includes("stack backtrace") ||
    lower.includes("panicked at") ||
    lower.includes("thread '") ||
    lower.includes(" at src/")
  ) {
    return fallback;
  }

  return safe;
}
