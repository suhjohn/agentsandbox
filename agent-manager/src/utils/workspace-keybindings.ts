function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseWorkspaceKeybindings(
  value: unknown,
): Record<string, unknown> | null {
  if (!isRecord(value)) return null;

  const disabledDefaultBindingIds = value.disabledDefaultBindingIds;
  const customBindings = value.customBindings;

  if (
    Array.isArray(disabledDefaultBindingIds) &&
    Array.isArray(customBindings) &&
    disabledDefaultBindingIds.length === 0 &&
    customBindings.length === 0
  ) {
    return null;
  }

  if (Object.keys(value).length === 0) {
    return null;
  }

  return value;
}
