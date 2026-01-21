export function newId(prefix?: string): string {
  const base =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
  return prefix ? `${prefix}_${base}` : base;
}

