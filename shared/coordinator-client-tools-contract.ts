export type CoordinatorClientToolVersion = 1;

export const COORDINATOR_UI_SEMANTIC_TOOL_NAMES = [
  "ui_get_state",
  "ui_list_available_actions",
  "ui_run_action",
] as const;

export type CoordinatorSemanticClientToolName =
  (typeof COORDINATOR_UI_SEMANTIC_TOOL_NAMES)[number];

export const COORDINATOR_UI_BROWSER_TOOL_NAMES = [
  "ui_browser_navigate",
  "ui_browser_snapshot",
  "ui_browser_click",
  "ui_browser_type",
  "ui_browser_wait",
  "ui_browser_scroll",
  "ui_browser_eval",
] as const;

export type CoordinatorBrowserClientToolName =
  (typeof COORDINATOR_UI_BROWSER_TOOL_NAMES)[number];

export const COORDINATOR_CLIENT_TOOL_NAMES = [
  ...COORDINATOR_UI_SEMANTIC_TOOL_NAMES,
  ...COORDINATOR_UI_BROWSER_TOOL_NAMES,
] as const;

export type CoordinatorClientToolName =
  (typeof COORDINATOR_CLIENT_TOOL_NAMES)[number];

const COORDINATOR_CLIENT_TOOL_NAME_SET = new Set<string>(
  COORDINATOR_CLIENT_TOOL_NAMES,
);

export function isCoordinatorClientToolName(
  value: string,
): value is CoordinatorClientToolName {
  return COORDINATOR_CLIENT_TOOL_NAME_SET.has(value);
}

export function isCoordinatorBrowserClientToolName(
  value: string,
): value is CoordinatorBrowserClientToolName {
  return (COORDINATOR_UI_BROWSER_TOOL_NAMES as readonly string[]).includes(value);
}

export function formatCoordinatorClientToolNameBullets(): string {
  return COORDINATOR_CLIENT_TOOL_NAMES.map((name) => `- \`${name}\``).join("\n");
}

export function assertCoordinatorClientToolNamesMatch(input: {
  readonly implementedToolNames: readonly string[];
  readonly source: string;
}): void {
  const declared = new Set<string>(COORDINATOR_CLIENT_TOOL_NAMES);
  const implemented = new Set<string>();
  const duplicateImplemented: string[] = [];
  const unknownImplemented: string[] = [];

  for (const toolName of input.implementedToolNames) {
    if (implemented.has(toolName)) {
      duplicateImplemented.push(toolName);
      continue;
    }
    implemented.add(toolName);
    if (!declared.has(toolName)) unknownImplemented.push(toolName);
  }

  const missing: string[] = [];
  for (const toolName of COORDINATOR_CLIENT_TOOL_NAMES) {
    if (!implemented.has(toolName)) missing.push(toolName);
  }

  if (duplicateImplemented.length === 0 && unknownImplemented.length === 0 && missing.length === 0) {
    return;
  }

  const problems: string[] = [];
  if (missing.length > 0) problems.push(`missing=[${missing.join(", ")}]`);
  if (unknownImplemented.length > 0) {
    problems.push(`unknown=[${unknownImplemented.join(", ")}]`);
  }
  if (duplicateImplemented.length > 0) {
    problems.push(`duplicates=[${duplicateImplemented.join(", ")}]`);
  }

  throw new Error(
    `Coordinator client tool contract mismatch for ${input.source}: ${problems.join("; ")}`,
  );
}
