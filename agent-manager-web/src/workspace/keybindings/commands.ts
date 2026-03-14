// ACTIONS_AND_KEYBINDINGS_SPEC: This file projects canonical UI actions into
// workspace keyboard command metadata. Keep
// docs/ACTIONS_AND_KEYBINDINGS_SPEC.md in sync with any additions or behavior
// changes here.
import { getUiActionDefinition, listUiActions } from "@/ui-actions/registry";
import type {
  KeybindingContext,
  WorkspaceCommandCategory,
  WorkspaceCommandDefinition,
  WorkspaceCommandId,
} from "./types";

type WorkspaceCommandProjection = {
  readonly category: WorkspaceCommandCategory;
  readonly contexts: readonly KeybindingContext[];
  readonly repeatable?: boolean;
};

const WORKSPACE_COMMAND_PROJECTIONS: Readonly<
  Partial<Record<WorkspaceCommandId, WorkspaceCommandProjection>>
> = {
  "keyboard.help.open": { category: "Keyboard", contexts: ["workspace.prefix"] },
  "keyboard.palette.open": {
    category: "Keyboard",
    contexts: ["workspace", "workspace.prefix"],
  },
  "keyboard.leader.send": { category: "Keyboard", contexts: ["workspace.prefix"] },
  "keyboard.mode.cancel": {
    category: "Keyboard",
    contexts: ["workspace", "workspace.prefix", "workspace.pane_number"],
  },
  "pane.split.down": { category: "Panes", contexts: ["workspace.prefix"] },
  "pane.split.right": { category: "Panes", contexts: ["workspace.prefix"] },
  "pane.split.down.full": { category: "Panes", contexts: ["workspace.prefix"] },
  "pane.split.right.full": { category: "Panes", contexts: ["workspace.prefix"] },
  "pane.close": { category: "Panes", contexts: ["workspace.prefix"] },
  "pane.zoom.toggle": { category: "Panes", contexts: ["workspace.prefix"] },
  "pane.focus.next": { category: "Panes", contexts: ["workspace.prefix"] },
  "pane.focus.last": { category: "Panes", contexts: ["workspace.prefix"] },
  "pane.focus.left": { category: "Panes", contexts: ["workspace.prefix"] },
  "pane.focus.right": { category: "Panes", contexts: ["workspace.prefix"] },
  "pane.focus.up": { category: "Panes", contexts: ["workspace.prefix"] },
  "pane.focus.down": { category: "Panes", contexts: ["workspace.prefix"] },
  "pane.number_mode.open": { category: "Panes", contexts: ["workspace.prefix"] },
  "pane.swap.prev": { category: "Panes", contexts: ["workspace.prefix"] },
  "pane.swap.next": { category: "Panes", contexts: ["workspace.prefix"] },
  "pane.rotate": { category: "Panes", contexts: ["workspace.prefix"] },
  "pane.break_to_window": { category: "Panes", contexts: ["workspace.prefix"] },
  "pane.resize.left": {
    category: "Panes",
    contexts: ["workspace.prefix"],
    repeatable: true,
  },
  "pane.resize.right": {
    category: "Panes",
    contexts: ["workspace.prefix"],
    repeatable: true,
  },
  "pane.resize.up": {
    category: "Panes",
    contexts: ["workspace.prefix"],
    repeatable: true,
  },
  "pane.resize.down": {
    category: "Panes",
    contexts: ["workspace.prefix"],
    repeatable: true,
  },
  "pane.type.prev": {
    category: "Panes",
    contexts: ["workspace.prefix"],
    repeatable: true,
  },
  "pane.type.next": {
    category: "Panes",
    contexts: ["workspace.prefix"],
    repeatable: true,
  },
  "pane.agent_view.prev": {
    category: "Panes",
    contexts: ["workspace.prefix"],
    repeatable: true,
  },
  "pane.agent_view.next": {
    category: "Panes",
    contexts: ["workspace.prefix"],
    repeatable: true,
  },
  "window.create": { category: "Windows", contexts: ["workspace.prefix"] },
  "window.close": { category: "Windows", contexts: ["workspace.prefix"] },
  "window.rename": { category: "Windows", contexts: ["workspace.prefix"] },
  "window.next": { category: "Windows", contexts: ["workspace.prefix"] },
  "window.prev": { category: "Windows", contexts: ["workspace.prefix"] },
  "window.last": { category: "Windows", contexts: ["workspace.prefix"] },
  "window.switcher.open": { category: "Windows", contexts: ["workspace.prefix"] },
  "window.select_index": { category: "Windows", contexts: ["workspace.prefix"] },
  "layout.cycle": { category: "Layout", contexts: ["workspace.prefix"] },
  "layout.equalize": { category: "Layout", contexts: ["workspace.prefix"] },
  "workspace.sessions_panel.toggle": { category: "Workspace", contexts: ["workspace.prefix"] },
  "workspace.sessions_panel.focus_filter": {
    category: "Workspace",
    contexts: ["workspace.prefix"],
  },
  "workspace.collapsibles.toggle_all": { category: "Workspace", contexts: ["workspace"] },
  "workspace.coordinator.open": { category: "Workspace", contexts: ["workspace.prefix"] },
  "workspace.stream.cancel": { category: "Workspace", contexts: ["workspace.prefix"] },
  "settings.open.general": { category: "Workspace", contexts: ["workspace.prefix"] },
  "settings.open.images": { category: "Workspace", contexts: ["workspace.prefix"] },
  "settings.open.keybindings": { category: "Workspace", contexts: ["workspace.prefix"] },
};

const COMMANDS = listUiActions()
  .filter((action) => action.surfaces.keyboard || action.surfaces.palette)
  .map((action): WorkspaceCommandDefinition | null => {
    const projection = WORKSPACE_COMMAND_PROJECTIONS[action.id as WorkspaceCommandId];
    if (!projection) return null;
    return {
      id: action.id as WorkspaceCommandId,
      title: action.title,
      description: action.description,
      category: projection.category,
      contexts: projection.contexts,
      ...(projection.repeatable ? { repeatable: true } : {}),
    };
  })
  .filter((command): command is WorkspaceCommandDefinition => command !== null);

export const WORKSPACE_KEYBINDING_COMMANDS = COMMANDS;

export const WORKSPACE_COMMAND_IDS = COMMANDS.map((command) => command.id);

const COMMANDS_BY_ID = new Map<WorkspaceCommandId, WorkspaceCommandDefinition>(
  COMMANDS.map((command) => [command.id, command]),
);

export function getWorkspaceCommand(commandId: WorkspaceCommandId): WorkspaceCommandDefinition {
  return COMMANDS_BY_ID.get(commandId)!;
}

export function isWorkspaceCommandId(value: unknown): value is WorkspaceCommandId {
  return (
    typeof value === "string" &&
    getUiActionDefinition(value) !== null &&
    COMMANDS_BY_ID.has(value as WorkspaceCommandId)
  );
}
