import type { UiActionId } from "../../../shared/ui-actions-contract";
import { assertCoordinatorSemanticActionIdsMatch } from "../../../shared/coordinator-actions-contract";
import { getUiActionDefinition, listUiActionDefinitions } from "@/ui-actions/registry";
import type { SemanticActionDefinition } from "./types";

const coordinatorActions = listUiActionDefinitions().filter(
  (actionDefinition) => actionDefinition.surfaces.coordinator,
) as readonly SemanticActionDefinition<any, any>[];

assertCoordinatorSemanticActionIdsMatch({
  implementedActionIds: coordinatorActions.map((actionDefinition) => actionDefinition.id),
  source: "agent-manager-web coordinator-actions registry",
});

export function listSemanticActions(): readonly SemanticActionDefinition<any, any>[] {
  return coordinatorActions;
}

export function getSemanticActionDefinition(
  actionId: UiActionId,
): SemanticActionDefinition<any, any> | null {
  const actionDefinition = getUiActionDefinition(actionId);
  if (!actionDefinition?.surfaces.coordinator) {
    return null;
  }
  return actionDefinition;
}
