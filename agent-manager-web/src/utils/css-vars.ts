/**
 * Utility to read CSS variable values as numbers (for icon sizes, etc.)
 */
export function getCssVarAsNumber(variable: string, fallback: number): number {
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(variable)
    .trim();
  const num = parseFloat(value);
  return Number.isNaN(num) ? fallback : num;
}

