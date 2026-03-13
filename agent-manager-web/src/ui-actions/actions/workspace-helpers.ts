import type { UiActionAvailability, UiContextSnapshot, UiExecutionContext } from "../types";
import { unavailable } from "./helpers";

export function requireWorkspaceController(ctx: UiExecutionContext) {
  const controller = ctx.workspaceController;
  if (!controller) {
    throw new Error("Workspace controller unavailable");
  }
  return controller;
}

export function requireWorkspaceKeyboardController(ctx: UiExecutionContext) {
  const controller = ctx.workspaceKeybindingController;
  if (!controller) {
    throw new Error("Workspace keyboard controller unavailable");
  }
  return controller;
}

export function canRunWorkspaceAction(
  ctx: UiContextSnapshot,
  options?: {
    readonly requireFocusedLeaf?: boolean;
    readonly requireSessionsPanelOpen?: boolean;
    readonly requireStreaming?: boolean;
    readonly requireMultipleWindows?: boolean;
    readonly requireMultipleLeaves?: boolean;
  },
): UiActionAvailability {
  if (!ctx.isAuthenticated) {
    return unavailable("NOT_AUTHENTICATED", "Log in before running workspace actions.");
  }
  if (ctx.routePath !== "/") {
    return unavailable("WRONG_ROUTE", "Workspace action requires the workspace route.");
  }
  if (!ctx.workspaceReady) {
    return unavailable("UI_NOT_READY", "Workspace runtime is not ready.");
  }
  if (options?.requireFocusedLeaf && ctx.workspaceFocusedLeafId === null) {
    return unavailable("MISSING_REQUIRED_ENTITY", "No focused workspace pane.");
  }
  if (options?.requireSessionsPanelOpen && !ctx.workspaceSessionsPanelOpen) {
    return unavailable("MISSING_REQUIRED_ENTITY", "Sessions side panel is closed.");
  }
  if (options?.requireStreaming && !ctx.chatStreaming) {
    return unavailable("MISSING_REQUIRED_ENTITY", "No active stream to cancel.");
  }
  if (options?.requireMultipleWindows && ctx.workspaceWindowCount <= 1) {
    return unavailable("MISSING_REQUIRED_ENTITY", "Cannot close the last workspace window.");
  }
  if (options?.requireMultipleLeaves && ctx.workspaceLeafCount <= 1) {
    return unavailable("MISSING_REQUIRED_ENTITY", "Cannot close the last workspace pane.");
  }
  return { ok: true };
}
