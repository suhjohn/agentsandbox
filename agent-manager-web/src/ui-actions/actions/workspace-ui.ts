import { createDirectWorkspaceAction } from "./workspace-shared";

export const workspaceSessionsPanelToggleAction = createDirectWorkspaceAction({
  actionId: "workspace.sessions_panel.toggle",
  run: async (ctx) => {
    const controller = ctx.workspaceKeybindingController;
    if (!controller) throw new Error("Sessions side panel controller unavailable");
    await controller.toggleSessionsPanel();
  },
});

export const workspaceSessionsPanelFocusFilterAction = createDirectWorkspaceAction({
  actionId: "workspace.sessions_panel.focus_filter",
  run: async (ctx) => {
    const controller = ctx.workspaceKeybindingController;
    if (!controller) throw new Error("Workspace keyboard UI controller unavailable");
    await controller.focusSessionsPanelFilter();
  },
});

export const workspaceCollapsiblesToggleAllAction = createDirectWorkspaceAction({
  actionId: "workspace.collapsibles.toggle_all",
  run: async (ctx) => {
    const controller = ctx.workspaceKeybindingController;
    if (!controller) throw new Error("Workspace keyboard UI controller unavailable");
    await controller.toggleAllCollapsibles();
  },
});

export const workspaceCoordinatorOpenAction = createDirectWorkspaceAction({
  actionId: "workspace.coordinator.open",
  run: async (ctx) => {
    const controller = ctx.workspaceKeybindingController;
    if (!controller) throw new Error("Workspace keyboard UI controller unavailable");
    await controller.openCoordinator();
  },
});

export const workspaceStreamCancelAction = createDirectWorkspaceAction({
  actionId: "workspace.stream.cancel",
  run: async (ctx) => {
    const controller = ctx.workspaceKeybindingController;
    if (!controller) throw new Error("Workspace keyboard UI controller unavailable");
    await controller.cancelFocusedStream();
  },
});

export const settingsOpenGeneralAction = createDirectWorkspaceAction({
  actionId: "settings.open.general",
  run: async (ctx) => {
    await ctx.navigate({ to: "/settings/general" });
  },
});

export const settingsOpenImagesAction = createDirectWorkspaceAction({
  actionId: "settings.open.images",
  run: async (ctx) => {
    await ctx.navigate({ to: "/settings/images" });
  },
});

export const settingsOpenKeybindingsAction = createDirectWorkspaceAction({
  actionId: "settings.open.keybindings",
  run: async (ctx) => {
    await ctx.navigate({ to: "/settings/keybindings" });
  },
});
