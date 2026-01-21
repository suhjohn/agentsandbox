import type { SemanticActionDefinition } from "./types";
import { assertCoordinatorSemanticActionIdsMatch } from "../../../shared/coordinator-actions-contract";
import {
  coordinatorCloseDialogAction,
  coordinatorOpenDialogAction,
  navGoAction,
} from "./actions/navigation";
import {
  chatClearDialogConversationAction,
  chatSendMessageAction,
  chatStopStreamAction,
} from "./actions/chat";
import {
  coordinatorDialogCreateSessionAction,
  coordinatorDialogListSessionsAction,
  coordinatorDialogOpenSessionsListAction,
  coordinatorDialogSelectSessionAction,
} from "./actions/dialog";
import {
  workspacePaneCloseAction,
  workspacePaneFocusAction,
  workspacePaneMoveAction,
  workspacePanelListAction,
  workspacePanelOpenAction,
  workspacePanelResizeAction,
  workspaceSessionsPanelCloseAction,
  workspaceSessionsPanelOpenAction,
  workspaceSessionsPanelSetFiltersAction,
  workspaceSessionsPanelSetGroupByAction,
  workspacePanelSetConfigAction,
} from "./actions/workspace";
import { workspaceKeybindingCommandActions } from "./actions/workspace-keybindings";
import { settingsActions } from "./actions/settings";

const actions = [
  navGoAction,
  workspacePanelListAction,
  workspacePaneFocusAction,
  workspacePaneMoveAction,
  workspacePaneCloseAction,
  workspacePanelOpenAction,
  workspacePanelSetConfigAction,
  workspacePanelResizeAction,
  workspaceSessionsPanelOpenAction,
  workspaceSessionsPanelCloseAction,
  workspaceSessionsPanelSetFiltersAction,
  workspaceSessionsPanelSetGroupByAction,
  coordinatorOpenDialogAction,
  coordinatorCloseDialogAction,
  coordinatorDialogOpenSessionsListAction,
  coordinatorDialogListSessionsAction,
  coordinatorDialogSelectSessionAction,
  coordinatorDialogCreateSessionAction,
  chatSendMessageAction,
  chatStopStreamAction,
  chatClearDialogConversationAction,
  ...settingsActions,
  ...workspaceKeybindingCommandActions,
] as const satisfies readonly SemanticActionDefinition<any, any>[];

assertCoordinatorSemanticActionIdsMatch({
  implementedActionIds: actions.map((action) => action.id),
  source: "agent-manager-web coordinator-actions registry",
});

const actionsById = new Map<string, SemanticActionDefinition<any, any>>(
  actions.map((action) => [action.id, action]),
);

export function listSemanticActions(): readonly SemanticActionDefinition<any, any>[] {
  return actions;
}

export function getSemanticActionDefinition(
  actionId: string,
): SemanticActionDefinition<any, any> | null {
  return actionsById.get(actionId) ?? null;
}
