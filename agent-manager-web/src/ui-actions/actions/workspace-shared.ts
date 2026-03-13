import { z } from "zod";
import type { UiActionDefinition, UiActionExecutionContext, UiContextSnapshot } from "../types";
import type { UiActionId } from "../../../../shared/ui-actions-contract";
import { getUiActionDescriptor } from "../../../../shared/ui-actions-contract";

export const EMPTY_PARAMS_SCHEMA = z.object({});
export const EMPTY_PARAMS_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {},
} as const;

export type WorkspaceActionResult<TActionId extends UiActionId = UiActionId> = {
  readonly executed: true;
  readonly actionId: TActionId;
};

const focusRequiredActions = new Set<UiActionId>([
  "pane.split.down",
  "pane.split.right",
  "pane.close",
  "pane.zoom.toggle",
  "pane.break_to_window",
  "pane.resize.left",
  "pane.resize.right",
  "pane.resize.up",
  "pane.resize.down",
  "pane.type.prev",
  "pane.type.next",
  "pane.agent_view.prev",
  "pane.agent_view.next",
]);

function unavailable(
  reason: "NOT_AUTHENTICATED" | "WRONG_ROUTE" | "UI_NOT_READY" | "MISSING_REQUIRED_ENTITY",
  details?: string,
) {
  return { ok: false as const, reason, ...(details ? { details } : {}) };
}

const WORKSPACE_KEYBINDING_CONTEXTS: Partial<Record<UiActionId, readonly string[]>> = {
  "keyboard.help.open": ["workspace.prefix"],
  "keyboard.palette.open": ["workspace", "workspace.prefix"],
  "keyboard.leader.send": ["workspace.prefix"],
  "keyboard.mode.cancel": ["workspace", "workspace.prefix", "workspace.pane_number"],
  "pane.split.down": ["workspace.prefix"],
  "pane.split.right": ["workspace.prefix"],
  "pane.split.down.full": ["workspace.prefix"],
  "pane.split.right.full": ["workspace.prefix"],
  "pane.close": ["workspace.prefix"],
  "pane.zoom.toggle": ["workspace.prefix"],
  "pane.focus.next": ["workspace.prefix"],
  "pane.focus.last": ["workspace.prefix"],
  "pane.focus.left": ["workspace.prefix"],
  "pane.focus.right": ["workspace.prefix"],
  "pane.focus.up": ["workspace.prefix"],
  "pane.focus.down": ["workspace.prefix"],
  "pane.number_mode.open": ["workspace.prefix"],
  "pane.swap.prev": ["workspace.prefix"],
  "pane.swap.next": ["workspace.prefix"],
  "pane.rotate": ["workspace.prefix"],
  "pane.break_to_window": ["workspace.prefix"],
  "pane.resize.left": ["workspace.prefix"],
  "pane.resize.right": ["workspace.prefix"],
  "pane.resize.up": ["workspace.prefix"],
  "pane.resize.down": ["workspace.prefix"],
  "pane.type.prev": ["workspace.prefix"],
  "pane.type.next": ["workspace.prefix"],
  "pane.agent_view.prev": ["workspace.prefix"],
  "pane.agent_view.next": ["workspace.prefix"],
  "window.create": ["workspace.prefix"],
  "window.close": ["workspace.prefix"],
  "window.rename": ["workspace.prefix"],
  "window.next": ["workspace.prefix"],
  "window.prev": ["workspace.prefix"],
  "window.last": ["workspace.prefix"],
  "window.switcher.open": ["workspace.prefix"],
  "window.select_index": ["workspace.prefix"],
  "layout.cycle": ["workspace.prefix"],
  "layout.equalize": ["workspace.prefix"],
  "workspace.sessions_panel.toggle": ["workspace.prefix"],
  "workspace.sessions_panel.focus_filter": ["workspace.prefix"],
  "workspace.collapsibles.toggle_all": ["workspace"],
  "workspace.coordinator.open": ["workspace.prefix"],
  "workspace.stream.cancel": ["workspace.prefix"],
  "settings.open.general": ["workspace.prefix"],
  "settings.open.images": ["workspace.prefix"],
  "settings.open.keybindings": ["workspace.prefix"],
};

const REPEATABLE_ACTIONS = new Set<UiActionId>([
  "pane.resize.left",
  "pane.resize.right",
  "pane.resize.up",
  "pane.resize.down",
  "pane.type.prev",
  "pane.type.next",
  "pane.agent_view.prev",
  "pane.agent_view.next",
]);

export function canRunWorkspaceAction(
  ctx: UiContextSnapshot,
  actionId: UiActionId,
) {
  if (!ctx.isAuthenticated) {
    return unavailable("NOT_AUTHENTICATED", "Log in before running workspace actions.");
  }
  if (ctx.routePath !== "/") {
    return unavailable("WRONG_ROUTE", "Workspace action requires the workspace route.");
  }
  if (!ctx.workspaceReady) {
    return unavailable("UI_NOT_READY", "Workspace runtime is not ready.");
  }
  if (focusRequiredActions.has(actionId) && ctx.workspaceFocusedLeafId === null) {
    return unavailable("MISSING_REQUIRED_ENTITY", "No focused workspace pane.");
  }
  if (actionId === "pane.close" && ctx.workspaceLeafCount <= 1) {
    return unavailable("MISSING_REQUIRED_ENTITY", "Cannot close the last workspace pane.");
  }
  if (actionId === "window.close" && ctx.workspaceWindowCount <= 1) {
    return unavailable("MISSING_REQUIRED_ENTITY", "Cannot close the last workspace window.");
  }
  if (actionId === "workspace.sessions_panel.focus_filter" && !ctx.workspaceSessionsPanelOpen) {
    return unavailable("MISSING_REQUIRED_ENTITY", "Sessions side panel is closed.");
  }
  if (actionId === "workspace.stream.cancel" && !ctx.chatStreaming) {
    return unavailable("MISSING_REQUIRED_ENTITY", "No active stream to cancel.");
  }
  if (actionId === "pane.number_mode.open" && ctx.workspaceLeafCount <= 0) {
    return unavailable("MISSING_REQUIRED_ENTITY", "No panes are available.");
  }
  return { ok: true as const };
}

export function createDirectWorkspaceAction<TActionId extends UiActionId>(input: {
  readonly actionId: TActionId;
  readonly canRun?: (ctx: UiContextSnapshot) => ReturnType<typeof canRunWorkspaceAction>;
  readonly run: (ctx: UiActionExecutionContext) => Promise<void>;
}): UiActionDefinition<Record<string, never>, WorkspaceActionResult<TActionId>> {
  const descriptor = getUiActionDescriptor(input.actionId);
  return {
    ...descriptor,
    paramsSchema: EMPTY_PARAMS_SCHEMA,
    paramsJsonSchema: EMPTY_PARAMS_JSON_SCHEMA,
    canRun: input.canRun ?? ((ctx) => canRunWorkspaceAction(ctx, input.actionId)),
    run: async (ctx) => {
      await input.run(ctx);
      return {
        executed: true as const,
        actionId: input.actionId,
      };
    },
    keybindingContexts: WORKSPACE_KEYBINDING_CONTEXTS[input.actionId],
    keybindingRepeatable: REPEATABLE_ACTIONS.has(input.actionId) ? true : undefined,
    keywords: [descriptor.id, descriptor.category],
  };
}
