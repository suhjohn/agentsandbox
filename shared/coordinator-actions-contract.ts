import {
  UI_ACTIONS,
  type UiActionVersion,
  formatUiActionIdBullets,
} from "./ui-actions-contract";

export type CoordinatorSemanticActionVersion = UiActionVersion;

export type CoordinatorSemanticActionDescriptor = {
  readonly id: string;
  readonly version: CoordinatorSemanticActionVersion;
  readonly description: string;
};

export const COORDINATOR_SEMANTIC_ACTIONS = UI_ACTIONS.filter(
  (action) => action.surfaces.coordinator,
).map((action) => ({
  id: action.id,
  version: action.version,
  description: action.description,
})) as readonly CoordinatorSemanticActionDescriptor[];

export type CoordinatorSemanticActionId =
  (typeof COORDINATOR_SEMANTIC_ACTIONS)[number]["id"];

export const COORDINATOR_SEMANTIC_ACTION_IDS =
  COORDINATOR_SEMANTIC_ACTIONS.map(
    (action) => action.id,
  ) as readonly CoordinatorSemanticActionId[];

export function formatCoordinatorSemanticActionIdBullets(): string {
  return formatUiActionIdBullets({ surface: "coordinator" });
}

export function assertCoordinatorSemanticActionIdsMatch(input: {
  readonly implementedActionIds: readonly string[];
  readonly source: string;
}): void {
  const declared = new Set<string>(COORDINATOR_SEMANTIC_ACTION_IDS);
  const implemented = new Set<string>();
  const duplicateImplemented: string[] = [];
  const unknownImplemented: string[] = [];

  for (const actionId of input.implementedActionIds) {
    if (implemented.has(actionId)) {
      duplicateImplemented.push(actionId);
      continue;
    }
    implemented.add(actionId);
    if (!declared.has(actionId)) unknownImplemented.push(actionId);
  }

  const missing: string[] = [];
  for (const actionId of COORDINATOR_SEMANTIC_ACTION_IDS) {
    if (!implemented.has(actionId)) missing.push(actionId);
  }

  if (duplicateImplemented.length === 0 && unknownImplemented.length === 0 && missing.length === 0) {
    return;
  }

  const problems: string[] = [];
  if (missing.length > 0) {
    problems.push(`missing=[${missing.join(", ")}]`);
  }
  if (unknownImplemented.length > 0) {
    problems.push(`unknown=[${unknownImplemented.join(", ")}]`);
  }
  if (duplicateImplemented.length > 0) {
    problems.push(`duplicates=[${duplicateImplemented.join(", ")}]`);
  }

  throw new Error(
    `Coordinator semantic action contract mismatch for ${input.source}: ${problems.join("; ")}`,
  );
}
