import {
  assertUiActionIdsMatch,
  type UiActionId,
  type UiActionSurfaces,
} from "../../../shared/ui-actions-contract";
import type { UiActionDefinition } from "./types";
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
import { settingsActions } from "./actions/settings";
import {
  workspacePaneCloseAction,
  workspacePaneFocusAction,
  workspacePaneMoveAction,
  workspacePanelListAction,
  workspacePanelOpenAction,
  workspacePanelResizeAction,
  workspacePanelSetConfigAction,
  workspaceSessionsPanelCloseAction,
  workspaceSessionsPanelOpenAction,
  workspaceSessionsPanelSetFiltersAction,
  workspaceSessionsPanelSetGroupByAction,
} from "./actions/workspace-semantic";
import {
  keyboardHelpOpenAction,
  keyboardLeaderSendAction,
  keyboardModeCancelAction,
  keyboardPaletteOpenAction,
  windowRenameAction,
  windowSwitcherOpenAction,
} from "./actions/keyboard-ui";
import {
  paneBreakToWindowAction,
  paneCloseAction,
  paneFocusDownAction,
  paneFocusLastAction,
  paneFocusLeftAction,
  paneFocusNextAction,
  paneFocusRightAction,
  paneFocusUpAction,
  paneNumberModeOpenAction,
  paneResizeDownAction,
  paneResizeLeftAction,
  paneResizeRightAction,
  paneResizeUpAction,
  paneRotateAction,
  paneSplitDownAction,
  paneSplitDownFullAction,
  paneSplitRightAction,
  paneSplitRightFullAction,
  paneSwapNextAction,
  paneSwapPrevAction,
  paneZoomToggleAction,
  layoutCycleAction,
  layoutEqualizeAction,
  windowSelectIndexAction,
} from "./actions/workspace-layout";
import {
  paneAgentViewNextAction,
  paneAgentViewPrevAction,
  paneTypeNextAction,
  paneTypePrevAction,
  windowCloseAction,
  windowCreateAction,
  windowLastAction,
  windowNextAction,
  windowPrevAction,
} from "./actions/workspace-panels";
import {
  settingsOpenGeneralAction,
  settingsOpenImagesAction,
  settingsOpenKeybindingsAction,
  workspaceCollapsiblesToggleAllAction,
  workspaceCoordinatorOpenAction,
  workspaceSessionsPanelFocusFilterAction,
  workspaceSessionsPanelToggleAction,
  workspaceStreamCancelAction,
} from "./actions/workspace-ui";

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
  keyboardHelpOpenAction,
  keyboardPaletteOpenAction,
  keyboardLeaderSendAction,
  keyboardModeCancelAction,
  paneSplitDownAction,
  paneSplitRightAction,
  paneSplitDownFullAction,
  paneSplitRightFullAction,
  paneCloseAction,
  paneZoomToggleAction,
  paneFocusNextAction,
  paneFocusLastAction,
  paneFocusLeftAction,
  paneFocusRightAction,
  paneFocusUpAction,
  paneFocusDownAction,
  paneNumberModeOpenAction,
  paneSwapPrevAction,
  paneSwapNextAction,
  paneRotateAction,
  paneBreakToWindowAction,
  paneResizeLeftAction,
  paneResizeRightAction,
  paneResizeUpAction,
  paneResizeDownAction,
  paneTypePrevAction,
  paneTypeNextAction,
  paneAgentViewPrevAction,
  paneAgentViewNextAction,
  windowCreateAction,
  windowCloseAction,
  windowRenameAction,
  windowNextAction,
  windowPrevAction,
  windowLastAction,
  windowSwitcherOpenAction,
  windowSelectIndexAction,
  layoutCycleAction,
  layoutEqualizeAction,
  workspaceSessionsPanelToggleAction,
  workspaceSessionsPanelFocusFilterAction,
  workspaceCollapsiblesToggleAllAction,
  workspaceCoordinatorOpenAction,
  workspaceStreamCancelAction,
  settingsOpenGeneralAction,
  settingsOpenImagesAction,
  settingsOpenKeybindingsAction,
] as const satisfies readonly UiActionDefinition<any, any>[];

assertUiActionIdsMatch({
  implementedActionIds: actions.map((actionDefinition) => actionDefinition.id),
  source: "agent-manager-web ui-actions registry",
});

const actionsById = new Map<UiActionId, UiActionDefinition<any, any>>(
  actions.map((actionDefinition) => [actionDefinition.id, actionDefinition]),
);

export function listUiActionDefinitions(): readonly UiActionDefinition<any, any>[] {
  return actions;
}

export function listUiActions(): readonly UiActionDefinition<any, any>[] {
  return actions;
}

export function listUiActionsForSurface(
  surface: keyof UiActionSurfaces,
): readonly UiActionDefinition<any, any>[] {
  return actions.filter((action) => action.surfaces[surface]);
}

export function getUiActionDefinition(
  actionId: UiActionId | string,
): UiActionDefinition<any, any> | null {
  return actionsById.get(actionId as UiActionId) ?? null;
}
