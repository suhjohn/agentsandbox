import { createDirectWorkspaceAction } from "./workspace-shared";

export const paneTypePrevAction = createDirectWorkspaceAction({
  actionId: "pane.type.prev",
  run: async (ctx) => {
    const controller = ctx.workspaceController;
    if (!controller) throw new Error("Workspace controller unavailable");
    await controller.cycleFocusedPaneType(-1);
  },
});

export const paneTypeNextAction = createDirectWorkspaceAction({
  actionId: "pane.type.next",
  run: async (ctx) => {
    const controller = ctx.workspaceController;
    if (!controller) throw new Error("Workspace controller unavailable");
    await controller.cycleFocusedPaneType(1);
  },
});

export const paneAgentViewPrevAction = createDirectWorkspaceAction({
  actionId: "pane.agent_view.prev",
  run: async (ctx) => {
    const controller = ctx.workspaceController;
    if (!controller) throw new Error("Workspace controller unavailable");
    await controller.cycleFocusedAgentView(-1);
  },
});

export const paneAgentViewNextAction = createDirectWorkspaceAction({
  actionId: "pane.agent_view.next",
  run: async (ctx) => {
    const controller = ctx.workspaceController;
    if (!controller) throw new Error("Workspace controller unavailable");
    await controller.cycleFocusedAgentView(1);
  },
});

export const windowCreateAction = createDirectWorkspaceAction({
  actionId: "window.create",
  run: async (ctx) => {
    const controller = ctx.workspaceController;
    if (!controller) throw new Error("Workspace controller unavailable");
    await controller.createWindow();
  },
});

export const windowCloseAction = createDirectWorkspaceAction({
  actionId: "window.close",
  run: async (ctx) => {
    const controller = ctx.workspaceController;
    if (!controller) throw new Error("Workspace controller unavailable");
    await controller.closeActiveWindow();
  },
});

export const windowNextAction = createDirectWorkspaceAction({
  actionId: "window.next",
  run: async (ctx) => {
    const controller = ctx.workspaceController;
    if (!controller) throw new Error("Workspace controller unavailable");
    await controller.activateWindow("next");
  },
});

export const windowPrevAction = createDirectWorkspaceAction({
  actionId: "window.prev",
  run: async (ctx) => {
    const controller = ctx.workspaceController;
    if (!controller) throw new Error("Workspace controller unavailable");
    await controller.activateWindow("prev");
  },
});

export const windowLastAction = createDirectWorkspaceAction({
  actionId: "window.last",
  run: async (ctx) => {
    const controller = ctx.workspaceController;
    if (!controller) throw new Error("Workspace controller unavailable");
    await controller.activateWindow("last");
  },
});
