export type CoordinatorSemanticActionVersion = 1;

export type CoordinatorSemanticActionDescriptor = {
  readonly id: string;
  readonly version: CoordinatorSemanticActionVersion;
  readonly description: string;
};

export const COORDINATOR_SEMANTIC_ACTIONS = [
  {
    id: "nav.go",
    version: 1,
    description: "Navigate to a route alias or absolute app route path.",
  },
  {
    id: "workspace.panel.list",
    version: 1,
    description: "List visible workspace panels with stable instance IDs.",
  },
  {
    id: "workspace.pane.focus",
    version: 1,
    description: "Focus an existing workspace pane by stable ID.",
  },
  {
    id: "workspace.pane.move",
    version: 1,
    description: "Move an existing workspace pane relative to another pane.",
  },
  {
    id: "workspace.pane.close",
    version: 1,
    description: "Close an existing workspace pane by stable target.",
  },
  {
    id: "workspace.panel.open",
    version: 1,
    description: "Open a workspace panel using semantic placement.",
  },
  {
    id: "workspace.panel.set_config",
    version: 1,
    description: "Patch workspace panel configuration for a target panel.",
  },
  {
    id: "workspace.panel.resize",
    version: 1,
    description: "Resize focused workspace panel width or height split.",
  },
  {
    id: "workspace.sessions_panel.open",
    version: 1,
    description: "Open the workspace Sessions side panel.",
  },
  {
    id: "workspace.sessions_panel.close",
    version: 1,
    description: "Close the workspace Sessions side panel.",
  },
  {
    id: "workspace.sessions_panel.set_filters",
    version: 1,
    description: "Patch workspace Sessions side panel filters.",
  },
  {
    id: "workspace.sessions_panel.set_group_by",
    version: 1,
    description: "Set workspace Sessions side panel group-by mode.",
  },
  {
    id: "coordinator.open_dialog",
    version: 1,
    description: "Open coordinator chat dialog.",
  },
  {
    id: "coordinator.close_dialog",
    version: 1,
    description: "Close coordinator chat dialog.",
  },
  {
    id: "coordinator.dialog.open_sessions_list",
    version: 1,
    description: "Switch coordinator dialog to sessions list mode.",
  },
  {
    id: "coordinator.dialog.list_sessions",
    version: 1,
    description: "List coordinator sessions available in dialog context.",
  },
  {
    id: "coordinator.dialog.select_session",
    version: 1,
    description: "Select a coordinator session in dialog conversation view.",
  },
  {
    id: "coordinator.dialog.create_session",
    version: 1,
    description: "Create and select a new coordinator session in dialog.",
  },
  {
    id: "chat.send_message",
    version: 1,
    description: "Send one user message in active coordinator conversation.",
  },
  {
    id: "chat.stop_stream",
    version: 1,
    description: "Stop currently streaming assistant response.",
  },
  {
    id: "chat.clear_dialog_conversation",
    version: 1,
    description: "Clear current dialog coordinator conversation.",
  },
  {
    id: "settings.general.set_name",
    version: 1,
    description: "Set display name input value on general settings page.",
  },
  {
    id: "settings.general.set_default_region",
    version: 1,
    description: "Set default region input text on general settings page.",
  },
  {
    id: "settings.general.save",
    version: 1,
    description: "Save pending general settings changes.",
  },
  {
    id: "settings.images.open_detail",
    version: 1,
    description: "Open image detail route from settings images list.",
  },
  {
    id: "settings.image_detail.set_name",
    version: 1,
    description: "Set image name field on settings image detail page.",
  },
  {
    id: "settings.image_detail.set_description",
    version: 1,
    description: "Set image description field on settings image detail page.",
  },
  {
    id: "settings.image_detail.set_setup_script",
    version: 1,
    description: "Set setup script text on settings image detail page.",
  },
  {
    id: "settings.image_detail.save",
    version: 1,
    description: "Save pending settings image detail draft changes.",
  },
  {
    id: "settings.image_detail.revert",
    version: 1,
    description: "Revert settings image detail draft changes.",
  },
  {
    id: "settings.image_detail.clone",
    version: 1,
    description: "Clone current image from settings image detail page.",
  },
  {
    id: "settings.image_detail.build.start",
    version: 1,
    description: "Start image build for selected variant on image detail page.",
  },
  {
    id: "settings.image_detail.build.stop",
    version: 1,
    description: "Stop active image build on image detail page.",
  },
  {
    id: "settings.image_detail.archive",
    version: 1,
    description: "Archive current image from settings image detail page.",
  },
  {
    id: "settings.image_detail.delete",
    version: 1,
    description: "Delete archived image from settings image detail page.",
  },
  {
    id: "settings.image_detail.secret.add_tab",
    version: 1,
    description: "Add a new secret-file tab on settings image detail page.",
  },
  {
    id: "settings.image_detail.secret.select_tab",
    version: 1,
    description: "Select secret-file tab by key on image detail page.",
  },
  {
    id: "settings.image_detail.secret.set_name",
    version: 1,
    description: "Set modal secret name for active secret tab.",
  },
  {
    id: "settings.image_detail.secret.set_path",
    version: 1,
    description: "Set file path for active secret tab.",
  },
  {
    id: "settings.image_detail.secret.set_env",
    version: 1,
    description: "Set dotenv contents for active secret tab.",
  },
  {
    id: "settings.image_detail.secret.save",
    version: 1,
    description: "Save active secret tab metadata and secret values.",
  },
  {
    id: "settings.image_detail.secret.delete_binding",
    version: 1,
    description: "Delete secret file binding by tab key on image detail page.",
  },
  {
    id: "keyboard.help.open",
    version: 1,
    description: "Open keyboard shortcuts overlay in workspace.",
  },
  {
    id: "keyboard.palette.open",
    version: 1,
    description: "Open workspace key bindings command list.",
  },
  {
    id: "keyboard.leader.send",
    version: 1,
    description: "Send literal leader sequence to focused panel.",
  },
  {
    id: "keyboard.mode.cancel",
    version: 1,
    description: "Cancel active keyboard mode and lightweight overlays.",
  },
  {
    id: "pane.split.down",
    version: 1,
    description: "Split focused pane downward.",
  },
  {
    id: "pane.split.right",
    version: 1,
    description: "Split focused pane to the right.",
  },
  {
    id: "pane.split.down.full",
    version: 1,
    description: "Split active window into full top/bottom regions.",
  },
  {
    id: "pane.split.right.full",
    version: 1,
    description: "Split active window into full left/right regions.",
  },
  {
    id: "pane.close",
    version: 1,
    description: "Close focused workspace pane.",
  },
  {
    id: "pane.zoom.toggle",
    version: 1,
    description: "Toggle expand for focused workspace pane.",
  },
  {
    id: "pane.focus.next",
    version: 1,
    description: "Focus next pane in traversal order.",
  },
  {
    id: "pane.focus.last",
    version: 1,
    description: "Focus previously focused pane.",
  },
  {
    id: "pane.focus.left",
    version: 1,
    description: "Focus pane to the left of current pane.",
  },
  {
    id: "pane.focus.right",
    version: 1,
    description: "Focus pane to the right of current pane.",
  },
  {
    id: "pane.focus.up",
    version: 1,
    description: "Focus pane above current pane.",
  },
  {
    id: "pane.focus.down",
    version: 1,
    description: "Focus pane below current pane.",
  },
  {
    id: "pane.number_mode.open",
    version: 1,
    description: "Open pane number chooser mode.",
  },
  {
    id: "pane.swap.prev",
    version: 1,
    description: "Swap focused pane with previous pane.",
  },
  {
    id: "pane.swap.next",
    version: 1,
    description: "Swap focused pane with next pane.",
  },
  {
    id: "pane.rotate",
    version: 1,
    description: "Rotate panes in traversal order.",
  },
  {
    id: "pane.break_to_window",
    version: 1,
    description: "Break focused pane into a new window.",
  },
  {
    id: "pane.resize.left",
    version: 1,
    description: "Resize focused pane toward left.",
  },
  {
    id: "pane.resize.right",
    version: 1,
    description: "Resize focused pane toward right.",
  },
  {
    id: "pane.resize.up",
    version: 1,
    description: "Resize focused pane toward top.",
  },
  {
    id: "pane.resize.down",
    version: 1,
    description: "Resize focused pane toward bottom.",
  },
  {
    id: "window.create",
    version: 1,
    description: "Create and activate new workspace window.",
  },
  {
    id: "window.close",
    version: 1,
    description: "Close active workspace window.",
  },
  {
    id: "window.rename",
    version: 1,
    description: "Open active workspace window rename flow.",
  },
  {
    id: "window.next",
    version: 1,
    description: "Activate next workspace window.",
  },
  {
    id: "window.prev",
    version: 1,
    description: "Activate previous workspace window.",
  },
  {
    id: "window.last",
    version: 1,
    description: "Activate last active workspace window.",
  },
  {
    id: "window.switcher.open",
    version: 1,
    description: "Open workspace window switcher.",
  },
  {
    id: "window.select_index",
    version: 1,
    description: "Activate workspace window by index.",
  },
  {
    id: "layout.cycle",
    version: 1,
    description: "Cycle practical workspace layouts.",
  },
  {
    id: "layout.equalize",
    version: 1,
    description: "Equalize workspace split ratios.",
  },
  {
    id: "workspace.sessions_panel.toggle",
    version: 1,
    description: "Toggle workspace sessions side panel.",
  },
  {
    id: "workspace.sessions_panel.focus_filter",
    version: 1,
    description: "Focus workspace sessions panel filter input.",
  },
  {
    id: "workspace.collapsibles.toggle_all",
    version: 1,
    description: "Toggle all collapsible tool-call sections.",
  },
  {
    id: "workspace.coordinator.open",
    version: 1,
    description: "Open coordinator dialog from workspace.",
  },
  {
    id: "workspace.stream.cancel",
    version: 1,
    description: "Cancel active stream in focused workspace panel.",
  },
  {
    id: "settings.open.general",
    version: 1,
    description: "Navigate to settings general page from workspace commands.",
  },
  {
    id: "settings.open.images",
    version: 1,
    description: "Navigate to settings images page from workspace commands.",
  },
  {
    id: "settings.open.keybindings",
    version: 1,
    description: "Navigate to settings keybindings page from workspace commands.",
  },
] as const satisfies readonly CoordinatorSemanticActionDescriptor[];

export type CoordinatorSemanticActionId =
  (typeof COORDINATOR_SEMANTIC_ACTIONS)[number]["id"];

export const COORDINATOR_SEMANTIC_ACTION_IDS =
  COORDINATOR_SEMANTIC_ACTIONS.map(
    (action) => action.id,
  ) as readonly CoordinatorSemanticActionId[];

export function formatCoordinatorSemanticActionIdBullets(): string {
  return COORDINATOR_SEMANTIC_ACTION_IDS.map((id) => `- \`${id}\``).join("\n");
}

export function assertCoordinatorSemanticActionIdsMatch(input: {
  readonly implementedActionIds: readonly string[];
  readonly source: string;
}): void {
  const declared = new Set<string>(COORDINATOR_SEMANTIC_ACTION_IDS);
  const implemented = new Set<string>();
  const duplicateImplemented: string[] = [];
  const unknownImplemented: string[] = [];

  for (const actionId of input.implementedActionIds) {
    if (implemented.has(actionId)) {
      duplicateImplemented.push(actionId);
      continue;
    }
    implemented.add(actionId);
    if (!declared.has(actionId)) unknownImplemented.push(actionId);
  }

  const missing: string[] = [];
  for (const actionId of COORDINATOR_SEMANTIC_ACTION_IDS) {
    if (!implemented.has(actionId)) missing.push(actionId);
  }

  if (duplicateImplemented.length === 0 && unknownImplemented.length === 0 && missing.length === 0) {
    return;
  }

  const problems: string[] = [];
  if (missing.length > 0) {
    problems.push(`missing=[${missing.join(", ")}]`);
  }
  if (unknownImplemented.length > 0) {
    problems.push(`unknown=[${unknownImplemented.join(", ")}]`);
  }
  if (duplicateImplemented.length > 0) {
    problems.push(`duplicates=[${duplicateImplemented.join(", ")}]`);
  }

  throw new Error(
    `Coordinator semantic action contract mismatch for ${input.source}: ${problems.join("; ")}`,
  );
}
