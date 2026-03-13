import type { QueryClient } from "@tanstack/react-query";
import type { AuthContextValue } from "@/lib/auth";
import type {
  UiActionExecutionContext,
  UiContextSnapshot,
  UiStateSnapshot,
} from "./types";
import {
  getActiveChatRuntimeController,
  getDialogRuntimeController,
  getSettingsGeneralRuntimeController,
  getSettingsImageDetailRuntimeController,
  getSettingsImagesRuntimeController,
  getSessionsSidePanelRuntimeController,
  getWorkspaceKeyboardRuntimeController,
  getWorkspaceRuntimeController,
  isCoordinatorDialogOpen,
} from "@/coordinator-actions/runtime-bridge";

function getRoutePath(): string {
  if (typeof window === "undefined") return "/";
  const path = window.location.pathname;
  return path.length > 0 ? path : "/";
}

function readActiveImageId(routePath: string): string | null {
  const match = /^\/settings\/images\/([^/]+)$/.exec(routePath);
  if (!match) return null;
  const imageId = match[1]?.trim() ?? "";
  return imageId.length > 0 ? decodeURIComponent(imageId) : null;
}

export function getUiContextSnapshot(auth: AuthContextValue): UiContextSnapshot {
  const routePath = getRoutePath();
  const workspace = getWorkspaceRuntimeController()?.getSnapshot();
  const sessionsPanel = getSessionsSidePanelRuntimeController()?.getSnapshot();
  const chat = getActiveChatRuntimeController();
  const settingsGeneral = getSettingsGeneralRuntimeController()?.getSnapshot();
  const settingsImages = getSettingsImagesRuntimeController()?.getSnapshot();
  const settingsImageDetail = getSettingsImageDetailRuntimeController()?.getSnapshot();

  return {
    isAuthenticated: !!auth.user,
    routePath,
    workspaceReady: workspace?.workspaceReady ?? false,
    workspaceWindowCount: workspace?.workspaceWindowCount ?? 0,
    workspaceLeafCount: workspace?.workspaceLeafCount ?? 0,
    workspaceFocusedLeafId: workspace?.workspaceFocusedLeafId ?? null,
    workspacePanelTypes: workspace?.workspacePanelTypes ?? [],
    workspaceSessionsPanelOpen: sessionsPanel?.open ?? false,
    workspaceSessionsPanelGroupBy: sessionsPanel?.groupBy ?? "none",
    workspaceSessionsPanelHasActiveFilters:
      sessionsPanel?.hasActiveFilters ?? false,
    chatDialogOpen: isCoordinatorDialogOpen(),
    chatStreaming: chat?.isStreaming() ?? false,
    chatHasConversation: chat?.hasConversation() ?? false,
    settingsGeneralReady: settingsGeneral !== undefined,
    settingsGeneralDirty: settingsGeneral?.isDirty ?? false,
    settingsGeneralCanSave: settingsGeneral?.canSave ?? false,
    settingsImagesReady: settingsImages !== undefined,
    settingsImagesCount: settingsImages?.imageIds.length ?? 0,
    settingsImageDetailReady: settingsImageDetail !== undefined,
    settingsImageLoaded: settingsImageDetail?.imageLoaded ?? false,
    settingsImageCanEdit: settingsImageDetail?.canEdit ?? false,
    settingsImageArchived: settingsImageDetail?.isArchived ?? false,
    settingsImageBuildRunning: settingsImageDetail?.isBuildRunning ?? false,
    activeImageId: settingsImageDetail?.imageId ?? readActiveImageId(routePath),
    hasDirtyImageDraft: settingsImageDetail?.hasDirtyDraft ?? false,
    isBusy: settingsImageDetail?.isBusy ?? false,
  };
}

export function getUiStateSnapshot(auth: AuthContextValue): UiStateSnapshot {
  const context = getUiContextSnapshot(auth);
  const workspace = getWorkspaceRuntimeController()?.getStateSnapshot() ?? null;
  return {
    capturedAt: new Date().toISOString(),
    context,
    workspace,
  };
}

export function buildUiActionExecutionContext(input: {
  readonly auth: AuthContextValue;
  readonly navigate: UiActionExecutionContext["navigate"];
  readonly queryClient: QueryClient;
}): UiActionExecutionContext {
  return {
    auth: input.auth,
    navigate: input.navigate,
    queryClient: input.queryClient,
    snapshot: getUiContextSnapshot(input.auth),
    chatController: getActiveChatRuntimeController(),
    dialogController: getDialogRuntimeController(),
    workspaceController: getWorkspaceRuntimeController(),
    workspaceKeybindingController: getWorkspaceKeyboardRuntimeController(),
    sessionsSidePanelController: getSessionsSidePanelRuntimeController(),
    settingsGeneralController: getSettingsGeneralRuntimeController(),
    settingsImagesController: getSettingsImagesRuntimeController(),
    settingsImageDetailController: getSettingsImageDetailRuntimeController(),
  };
}

export const buildUiExecutionContext = buildUiActionExecutionContext;
