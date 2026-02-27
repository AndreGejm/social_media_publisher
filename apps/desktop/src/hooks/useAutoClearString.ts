import type { Dispatch, SetStateAction } from "react";
import { useEffect } from "react";

export function useAutoClearString(
  value: string | null,
  setValue: Dispatch<SetStateAction<string | null>>,
  delayMs: number
): void {
  useEffect(() => {
    if (!value) return;
    const timer = window.setTimeout(() => {
      setValue((current) => (current === value ? null : current));
    }, delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs, setValue, value]);
}
