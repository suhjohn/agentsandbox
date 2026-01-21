export function toErrorMessage(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === "object" && value !== null && "error" in value) {
    const err = (value as { error?: unknown }).error;
    if (typeof err === "string" && err.trim().length > 0) return err;
  }
  if (typeof value === "string" && value.trim().length > 0) return value;
  return "Something went wrong.";
}

export function clampLimit(value: number): number {
  if (!Number.isFinite(value)) return 20;
  return Math.min(50, Math.max(1, Math.round(value)));
}

export function unwrapData<T>(
  value: unknown,
  validator: (data: Record<string, unknown>) => T | null,
): T | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.data === "object" && v.data !== null) {
    return validator(v.data as Record<string, unknown>);
  }
  return validator(v);
}
