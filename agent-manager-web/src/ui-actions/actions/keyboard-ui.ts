import { toast } from "sonner";
import { WORKSPACE_CANCEL_STREAM_EVENT } from "@/workspace/keybindings/events";
import { createDirectWorkspaceAction } from "./workspace-shared";

function dispatchCancelStream(leafId: string | null): void {
  window.dispatchEvent(
    new CustomEvent(WORKSPACE_CANCEL_STREAM_EVENT, {
      detail: leafId ? { leafId } : {},
    }),
  );
}

export const keyboardHelpOpenAction = createDirectWorkspaceAction({
  actionId: "keyboard.help.open",
  run: async (ctx) => {
    const controller = ctx.workspaceKeybindingController;
    if (!controller) throw new Error("Workspace keyboard UI controller unavailable");
    await controller.openHelp();
  },
});

export const keyboardPaletteOpenAction = createDirectWorkspaceAction({
  actionId: "keyboard.palette.open",
  run: async (ctx) => {
    const controller = ctx.workspaceKeybindingController;
    if (!controller) throw new Error("Workspace keyboard UI controller unavailable");
    await controller.openPalette();
  },
});

export const keyboardLeaderSendAction = createDirectWorkspaceAction({
  actionId: "keyboard.leader.send",
  run: async () => {
    toast.message("Leader pass-through is handled by focused terminal input.");
  },
});

export const keyboardModeCancelAction = createDirectWorkspaceAction({
  actionId: "keyboard.mode.cancel",
  run: async (ctx) => {
    const controller = ctx.workspaceKeybindingController;
    if (!controller) throw new Error("Workspace keyboard UI controller unavailable");
    await controller.closeTransientUi();
    dispatchCancelStream(ctx.snapshot.workspaceFocusedLeafId);
  },
});

export const windowSwitcherOpenAction = createDirectWorkspaceAction({
  actionId: "window.switcher.open",
  run: async (ctx) => {
    const controller = ctx.workspaceKeybindingController;
    if (!controller) throw new Error("Workspace keyboard UI controller unavailable");
    await controller.openWindowSwitcher();
  },
});

export const windowRenameAction = createDirectWorkspaceAction({
  actionId: "window.rename",
  run: async (ctx) => {
    const controller = ctx.workspaceKeybindingController;
    if (!controller) throw new Error("Workspace keyboard UI controller unavailable");
    await controller.openRenameWindowDialog();
  },
});
