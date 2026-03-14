// ACTIONS_AND_KEYBINDINGS_SPEC: This file defines workspace layout and pane
// keyboard actions. Keep docs/ACTIONS_AND_KEYBINDINGS_SPEC.md in sync with any
// additions or behavior changes here.
import { z } from "zod";
import {
  WORKSPACE_PANE_ZOOM_TOGGLE_EVENT,
} from "@/workspace/keybindings/events";
import { getUiActionDescriptor } from "../../../../shared/ui-actions-contract";
import type { UiActionDefinition } from "../types";
import {
  canRunWorkspaceAction,
  createDirectWorkspaceAction,
  type WorkspaceActionResult,
} from "./workspace-shared";

function dispatchPaneZoomToggle(leafId: string | null): void {
  if (!leafId) return;
  window.dispatchEvent(
    new CustomEvent(WORKSPACE_PANE_ZOOM_TOGGLE_EVENT, {
      detail: { leafId },
    }),
  );
}

export const paneSplitDownAction = createDirectWorkspaceAction({
  actionId: "pane.split.down",
  run: async (ctx) => {
    const controller = ctx.workspaceController;
    if (!controller) throw new Error("Workspace controller unavailable");
    await controller.splitFocusedPane("col");
  },
});

export const paneSplitRightAction = createDirectWorkspaceAction({
  actionId: "pane.split.right",
  run: async (ctx) => {
    const controller = ctx.workspaceController;
    if (!controller) throw new Error("Workspace controller unavailable");
    await controller.splitFocusedPane("row");
  },
});

export const paneSplitDownFullAction = createDirectWorkspaceAction({
  actionId: "pane.split.down.full",
  run: async (ctx) => {
    const controller = ctx.workspaceController;
    if (!controller) throw new Error("Workspace controller unavailable");
    await controller.splitWindowFull("col");
  },
});

export const paneSplitRightFullAction = createDirectWorkspaceAction({
  actionId: "pane.split.right.full",
  run: async (ctx) => {
    const controller = ctx.workspaceController;
    if (!controller) throw new Error("Workspace controller unavailable");
    await controller.splitWindowFull("row");
  },
});

export const paneCloseAction = createDirectWorkspaceAction({
  actionId: "pane.close",
  run: async (ctx) => {
    const controller = ctx.workspaceController;
    if (!controller) throw new Error("Workspace controller unavailable");
    await controller.closePane({ target: "focused" });
  },
});

export const paneZoomToggleAction = createDirectWorkspaceAction({
  actionId: "pane.zoom.toggle",
  run: async (ctx) => {
    dispatchPaneZoomToggle(ctx.snapshot.workspaceFocusedLeafId);
  },
});

export const paneFocusNextAction = createDirectWorkspaceAction({
  actionId: "pane.focus.next",
  run: async (ctx) => {
    const controller = ctx.workspaceController;
    if (!controller) throw new Error("Workspace controller unavailable");
    await controller.focusTraversal("next");
  },
});

export const paneFocusLastAction = createDirectWorkspaceAction({
  actionId: "pane.focus.last",
  run: async (ctx) => {
    const controller = ctx.workspaceController;
    if (!controller) throw new Error("Workspace controller unavailable");
    await controller.focusTraversal("prev");
  },
});

export const paneFocusLeftAction = createDirectWorkspaceAction({
  actionId: "pane.focus.left",
  run: async (ctx) => {
    const controller = ctx.workspaceController;
    if (!controller) throw new Error("Workspace controller unavailable");
    await controller.focusDirection("left");
  },
});

export const paneFocusRightAction = createDirectWorkspaceAction({
  actionId: "pane.focus.right",
  run: async (ctx) => {
    const controller = ctx.workspaceController;
    if (!controller) throw new Error("Workspace controller unavailable");
    await controller.focusDirection("right");
  },
});

export const paneFocusUpAction = createDirectWorkspaceAction({
  actionId: "pane.focus.up",
  run: async (ctx) => {
    const controller = ctx.workspaceController;
    if (!controller) throw new Error("Workspace controller unavailable");
    await controller.focusDirection("up");
  },
});

export const paneFocusDownAction = createDirectWorkspaceAction({
  actionId: "pane.focus.down",
  run: async (ctx) => {
    const controller = ctx.workspaceController;
    if (!controller) throw new Error("Workspace controller unavailable");
    await controller.focusDirection("down");
  },
});

export const paneNumberModeOpenAction = createDirectWorkspaceAction({
  actionId: "pane.number_mode.open",
  run: async (ctx) => {
    const controller = ctx.workspaceKeybindingController;
    if (!controller) throw new Error("Workspace keyboard controller unavailable");
    await controller.enterPaneNumberMode();
  },
});

export const paneSwapPrevAction = createDirectWorkspaceAction({
  actionId: "pane.swap.prev",
  run: async (ctx) => {
    const controller = ctx.workspaceController;
    if (!controller) throw new Error("Workspace controller unavailable");
    await controller.swapTraversal("prev");
  },
});

export const paneSwapNextAction = createDirectWorkspaceAction({
  actionId: "pane.swap.next",
  run: async (ctx) => {
    const controller = ctx.workspaceController;
    if (!controller) throw new Error("Workspace controller unavailable");
    await controller.swapTraversal("next");
  },
});

export const paneRotateAction = createDirectWorkspaceAction({
  actionId: "pane.rotate",
  run: async (ctx) => {
    const controller = ctx.workspaceController;
    if (!controller) throw new Error("Workspace controller unavailable");
    await controller.rotatePanes();
  },
});

export const paneBreakToWindowAction = createDirectWorkspaceAction({
  actionId: "pane.break_to_window",
  run: async (ctx) => {
    const controller = ctx.workspaceController;
    if (!controller) throw new Error("Workspace controller unavailable");
    await controller.breakFocusedPaneToWindow();
  },
});

export const paneResizeLeftAction = createDirectWorkspaceAction({
  actionId: "pane.resize.left",
  run: async (ctx) => {
    const controller = ctx.workspaceController;
    if (!controller) throw new Error("Workspace controller unavailable");
    await controller.resizeDirection("left", 0.02);
  },
});

export const paneResizeRightAction = createDirectWorkspaceAction({
  actionId: "pane.resize.right",
  run: async (ctx) => {
    const controller = ctx.workspaceController;
    if (!controller) throw new Error("Workspace controller unavailable");
    await controller.resizeDirection("right", 0.02);
  },
});

export const paneResizeUpAction = createDirectWorkspaceAction({
  actionId: "pane.resize.up",
  run: async (ctx) => {
    const controller = ctx.workspaceController;
    if (!controller) throw new Error("Workspace controller unavailable");
    await controller.resizeDirection("up", 0.02);
  },
});

export const paneResizeDownAction = createDirectWorkspaceAction({
  actionId: "pane.resize.down",
  run: async (ctx) => {
    const controller = ctx.workspaceController;
    if (!controller) throw new Error("Workspace controller unavailable");
    await controller.resizeDirection("down", 0.02);
  },
});

export const layoutCycleAction = createDirectWorkspaceAction({
  actionId: "layout.cycle",
  run: async (ctx) => {
    const controller = ctx.workspaceController;
    if (!controller) throw new Error("Workspace controller unavailable");
    await controller.cycleLayout();
  },
});

export const layoutEqualizeAction = createDirectWorkspaceAction({
  actionId: "layout.equalize",
  run: async (ctx) => {
    const controller = ctx.workspaceController;
    if (!controller) throw new Error("Workspace controller unavailable");
    await controller.equalizeLayout();
  },
});

const windowSelectIndexParamsSchema = z.object({
  index: z.number().int().min(0).max(9),
});

export const windowSelectIndexAction: UiActionDefinition<
  z.infer<typeof windowSelectIndexParamsSchema>,
  WorkspaceActionResult<"window.select_index">
> = {
  ...getUiActionDescriptor("window.select_index"),
  paramsSchema: windowSelectIndexParamsSchema,
  paramsJsonSchema: {
    type: "object",
    additionalProperties: false,
    required: ["index"],
    properties: {
      index: {
        type: "integer",
        minimum: 0,
        maximum: 9,
      },
    },
  },
  canRun: (ctx) => canRunWorkspaceAction(ctx, "window.select_index"),
  run: async (ctx, params) => {
    const controller = ctx.workspaceController;
    if (!controller) throw new Error("Workspace controller unavailable");
    await controller.activateWindow({ index: params.index });
    return {
      executed: true as const,
      actionId: "window.select_index" as const,
    };
  },
};
