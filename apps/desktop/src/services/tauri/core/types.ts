export type UiAppError = { code: string; message: string; details?: unknown };

export function isUiAppError(error: unknown): error is UiAppError {
  return (
    error != null &&
    typeof error === "object" &&
    "code" in error &&
    "message" in error &&
    typeof (error as { code?: unknown }).code === "string" &&
    typeof (error as { message?: unknown }).message === "string"
  );
}
