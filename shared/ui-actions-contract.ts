// ACTIONS_AND_KEYBINDINGS_SPEC: This file defines the shared canonical UI
// action contract that frontend action registries and workspace keybindings
// build on. Keep docs/ACTIONS_AND_KEYBINDINGS_SPEC.md in sync with any
// additions or behavior changes here.
export type UiActionVersion = 1;

export type UiActionCategory = "direct" | "parameterized";

export type UiActionSurfaces = {
  readonly keyboard: boolean;
  readonly palette: boolean;
  readonly coordinator: boolean;
};

export type UiActionDescriptor = {
  readonly id: string;
  readonly version: UiActionVersion;
  readonly title: string;
  readonly description: string;
  readonly category: UiActionCategory;
  readonly surfaces: UiActionSurfaces;
  readonly paramsJsonSchema: Record<string, unknown>;
};

function defineUiActionDescriptors<const T extends readonly UiActionDescriptor[]>(
  descriptors: T,
): T {
  return descriptors;
}

const EMPTY_PARAMS_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {},
} as const;

export const UI_ACTIONS = defineUiActionDescriptors([
  { id: "nav.go", version: 1, title: "Navigate", description: "Navigate to a route alias or absolute app route path.", category: "parameterized", surfaces: { keyboard: false, palette: false, coordinator: true }, paramsJsonSchema: { type: "object", additionalProperties: false, properties: { to: { type: "string" }, path: { type: "string" }, params: { type: "object", additionalProperties: true }, search: { type: "object", additionalProperties: true }, hash: { type: "string" }, replace: { type: "boolean" } } } },
  { id: "workspace.panel.list", version: 1, title: "List Workspace Panels", description: "List visible workspace panels with stable instance IDs.", category: "direct", surfaces: { keyboard: false, palette: false, coordinator: true }, paramsJsonSchema: EMPTY_PARAMS_JSON_SCHEMA },
  { id: "workspace.pane.focus", version: 1, title: "Focus Workspace Pane", description: "Focus an existing workspace pane by stable ID.", category: "parameterized", surfaces: { keyboard: false, palette: false, coordinator: true }, paramsJsonSchema: { type: "object", additionalProperties: false, required: ["target"], properties: { target: { type: "string", enum: ["leaf", "panel_instance"] }, leafId: { type: "string" }, panelInstanceId: { type: "string" } } } },
  { id: "workspace.pane.move", version: 1, title: "Move Workspace Pane", description: "Move an existing workspace pane relative to another pane.", category: "parameterized", surfaces: { keyboard: false, palette: false, coordinator: true }, paramsJsonSchema: { type: "object", additionalProperties: false, required: ["placement"], properties: { fromLeafId: { type: "string" }, fromPanelInstanceId: { type: "string" }, toLeafId: { type: "string" }, toPanelInstanceId: { type: "string" }, placement: { type: "string", enum: ["left", "right", "top", "bottom"] } } } },
  { id: "workspace.pane.close", version: 1, title: "Close Workspace Pane", description: "Close an existing workspace pane by stable target.", category: "parameterized", surfaces: { keyboard: false, palette: false, coordinator: true }, paramsJsonSchema: { type: "object", additionalProperties: false, required: ["target"], properties: { target: { type: "string", enum: ["focused", "leaf", "panel_instance"] }, leafId: { type: "string" }, panelInstanceId: { type: "string" } } } },
  { id: "workspace.panel.open", version: 1, title: "Open Workspace Panel", description: "Open a workspace panel using semantic placement.", category: "parameterized", surfaces: { keyboard: false, palette: false, coordinator: true }, paramsJsonSchema: { type: "object", additionalProperties: false, required: ["panelType", "placement"], properties: { panelType: { type: "string", enum: ["coordinator", "agent_list", "agent_create", "agent_detail", "empty"] }, placement: { type: "string", enum: ["self", "left", "right", "top", "bottom"] }, config: { type: "object", additionalProperties: true } } } },
  { id: "workspace.panel.set_config", version: 1, title: "Set Workspace Panel Config", description: "Patch workspace panel configuration for a target panel.", category: "parameterized", surfaces: { keyboard: false, palette: false, coordinator: true }, paramsJsonSchema: { type: "object", additionalProperties: false, required: ["target", "patch"], properties: { target: { type: "string", enum: ["focused", "first_of_type", "panel_instance"] }, panelType: { type: "string", enum: ["coordinator", "agent_list", "agent_create", "agent_detail", "empty"] }, panelInstanceId: { type: "string" }, patch: { type: "object", additionalProperties: true } } } },
  { id: "workspace.panel.resize", version: 1, title: "Resize Workspace Panel", description: "Resize focused workspace panel width or height split.", category: "parameterized", surfaces: { keyboard: false, palette: false, coordinator: true }, paramsJsonSchema: { type: "object", additionalProperties: false, required: ["dimension", "mode", "value"], properties: { dimension: { type: "string", enum: ["width", "height"] }, mode: { type: "string", enum: ["set_fraction", "delta_fraction"] }, value: { type: "number" } } } },
  { id: "workspace.sessions_panel.open", version: 1, title: "Open Sessions Panel", description: "Open the workspace Sessions side panel.", category: "direct", surfaces: { keyboard: false, palette: false, coordinator: true }, paramsJsonSchema: EMPTY_PARAMS_JSON_SCHEMA },
  { id: "workspace.sessions_panel.close", version: 1, title: "Close Sessions Panel", description: "Close the workspace Sessions side panel.", category: "direct", surfaces: { keyboard: false, palette: false, coordinator: true }, paramsJsonSchema: EMPTY_PARAMS_JSON_SCHEMA },
  { id: "workspace.sessions_panel.set_filters", version: 1, title: "Set Sessions Panel Filters", description: "Patch workspace Sessions side panel filters.", category: "parameterized", surfaces: { keyboard: false, palette: false, coordinator: true }, paramsJsonSchema: { type: "object", additionalProperties: false, properties: { imageId: { type: "string" }, agentId: { type: "string" }, createdBy: { type: "string" }, archived: { type: "string", enum: ["all", "true", "false"] }, status: { type: "string" }, updatedAtRange: { type: "string", enum: ["all", "24h", "7d", "30d", "90d"] }, createdAtRange: { type: "string", enum: ["all", "24h", "7d", "30d", "90d"] }, q: { type: "string" } } } },
  { id: "workspace.sessions_panel.set_group_by", version: 1, title: "Set Sessions Panel Grouping", description: "Set workspace Sessions side panel group-by mode.", category: "parameterized", surfaces: { keyboard: false, palette: false, coordinator: true }, paramsJsonSchema: { type: "object", additionalProperties: false, required: ["groupBy"], properties: { groupBy: { type: "string", enum: ["none", "imageId", "createdBy", "status"] } } } },
  { id: "coordinator.open_dialog", version: 1, title: "Open Coordinator Dialog", description: "Open coordinator chat dialog.", category: "direct", surfaces: { keyboard: false, palette: false, coordinator: true }, paramsJsonSchema: EMPTY_PARAMS_JSON_SCHEMA },
  { id: "coordinator.close_dialog", version: 1, title: "Close Coordinator Dialog", description: "Close coordinator chat dialog.", category: "direct", surfaces: { keyboard: false, palette: false, coordinator: true }, paramsJsonSchema: EMPTY_PARAMS_JSON_SCHEMA },
  { id: "coordinator.dialog.open_sessions_list", version: 1, title: "Open Coordinator Sessions List", description: "Switch coordinator dialog to sessions list mode.", category: "direct", surfaces: { keyboard: false, palette: false, coordinator: true }, paramsJsonSchema: EMPTY_PARAMS_JSON_SCHEMA },
  { id: "coordinator.dialog.list_sessions", version: 1, title: "List Coordinator Sessions", description: "List coordinator sessions available in dialog context.", category: "parameterized", surfaces: { keyboard: false, palette: false, coordinator: true }, paramsJsonSchema: { type: "object", additionalProperties: false, properties: { limit: { type: "integer", minimum: 1, maximum: 100 }, cursor: { type: "string", minLength: 1 } } } },
  { id: "coordinator.dialog.select_session", version: 1, title: "Select Coordinator Session", description: "Select a session in the coordinator dialog conversation view.", category: "parameterized", surfaces: { keyboard: false, palette: false, coordinator: true }, paramsJsonSchema: { type: "object", additionalProperties: false, required: ["sessionId"], properties: { sessionId: { type: "string", minLength: 1 } } } },
  { id: "coordinator.dialog.create_session", version: 1, title: "Create Coordinator Session", description: "Create and select a new coordinator session in dialog.", category: "parameterized", surfaces: { keyboard: false, palette: false, coordinator: true }, paramsJsonSchema: { type: "object", additionalProperties: false, properties: { title: { type: "string", minLength: 1 } } } },
  { id: "chat.send_message", version: 1, title: "Send Chat Message", description: "Send one user message in active coordinator conversation.", category: "parameterized", surfaces: { keyboard: false, palette: false, coordinator: true }, paramsJsonSchema: { type: "object", additionalProperties: false, required: ["text"], properties: { text: { type: "string", minLength: 1 } } } },
  { id: "chat.stop_stream", version: 1, title: "Stop Chat Stream", description: "Stop currently streaming assistant response.", category: "direct", surfaces: { keyboard: false, palette: false, coordinator: true }, paramsJsonSchema: EMPTY_PARAMS_JSON_SCHEMA },
  { id: "chat.clear_dialog_conversation", version: 1, title: "Clear Dialog Conversation", description: "Clear current dialog coordinator conversation.", category: "parameterized", surfaces: { keyboard: false, palette: false, coordinator: true }, paramsJsonSchema: { type: "object", additionalProperties: false, required: ["confirm"], properties: { confirm: { const: true } } } },
  { id: "settings.general.set_name", version: 1, title: "Set General Settings Name", description: "Set display name input value on general settings page.", category: "parameterized", surfaces: { keyboard: false, palette: false, coordinator: true }, paramsJsonSchema: { type: "object", additionalProperties: false, required: ["name"], properties: { name: { type: "string" } } } },
  { id: "settings.general.set_default_region", version: 1, title: "Set Default Region", description: "Set default region input text on general settings page.", category: "parameterized", surfaces: { keyboard: false, palette: false, coordinator: true }, paramsJsonSchema: { type: "object", additionalProperties: false, required: ["regionText"], properties: { regionText: { type: "string" } } } },
  { id: "settings.general.save", version: 1, title: "Save General Settings", description: "Save pending general settings changes.", category: "direct", surfaces: { keyboard: false, palette: false, coordinator: true }, paramsJsonSchema: EMPTY_PARAMS_JSON_SCHEMA },
  { id: "settings.images.open_detail", version: 1, title: "Open Image Detail", description: "Open image detail route from settings images list.", category: "parameterized", surfaces: { keyboard: false, palette: false, coordinator: true }, paramsJsonSchema: { type: "object", additionalProperties: false, required: ["imageId"], properties: { imageId: { type: "string", minLength: 1 } } } },
  { id: "settings.image_detail.set_name", version: 1, title: "Set Image Name", description: "Set image name field on settings image detail page.", category: "parameterized", surfaces: { keyboard: false, palette: false, coordinator: true }, paramsJsonSchema: { type: "object", additionalProperties: false, required: ["name"], properties: { name: { type: "string" } } } },
  { id: "settings.image_detail.set_description", version: 1, title: "Set Image Description", description: "Set image description field on settings image detail page.", category: "parameterized", surfaces: { keyboard: false, palette: false, coordinator: true }, paramsJsonSchema: { type: "object", additionalProperties: false, required: ["description"], properties: { description: { type: "string" } } } },
  { id: "settings.image_detail.save", version: 1, title: "Save Image Detail", description: "Save pending settings image detail draft changes.", category: "direct", surfaces: { keyboard: false, palette: false, coordinator: true }, paramsJsonSchema: EMPTY_PARAMS_JSON_SCHEMA },
  { id: "settings.image_detail.revert", version: 1, title: "Revert Image Detail", description: "Revert settings image detail draft changes.", category: "direct", surfaces: { keyboard: false, palette: false, coordinator: true }, paramsJsonSchema: EMPTY_PARAMS_JSON_SCHEMA },
  { id: "settings.image_detail.clone", version: 1, title: "Clone Image", description: "Clone current image from settings image detail page.", category: "direct", surfaces: { keyboard: false, palette: false, coordinator: true }, paramsJsonSchema: EMPTY_PARAMS_JSON_SCHEMA },
  { id: "settings.image_detail.build.start", version: 1, title: "Start Image Build", description: "Start image build for selected variant on image detail page.", category: "direct", surfaces: { keyboard: false, palette: false, coordinator: true }, paramsJsonSchema: EMPTY_PARAMS_JSON_SCHEMA },
  { id: "settings.image_detail.build.stop", version: 1, title: "Stop Image Build", description: "Stop active image build on image detail page.", category: "direct", surfaces: { keyboard: false, palette: false, coordinator: true }, paramsJsonSchema: EMPTY_PARAMS_JSON_SCHEMA },
  { id: "settings.image_detail.archive", version: 1, title: "Archive Image", description: "Archive current image from settings image detail page.", category: "parameterized", surfaces: { keyboard: false, palette: false, coordinator: true }, paramsJsonSchema: { type: "object", additionalProperties: false, required: ["confirm"], properties: { confirm: { const: true } } } },
  { id: "settings.image_detail.delete", version: 1, title: "Delete Image", description: "Delete archived image from settings image detail page.", category: "parameterized", surfaces: { keyboard: false, palette: false, coordinator: true }, paramsJsonSchema: { type: "object", additionalProperties: false, required: ["confirm"], properties: { confirm: { const: true } } } },
  { id: "keyboard.help.open", version: 1, title: "Open Keyboard Shortcuts", description: "Open keyboard shortcuts overlay in workspace.", category: "direct", surfaces: { keyboard: true, palette: true, coordinator: true }, paramsJsonSchema: EMPTY_PARAMS_JSON_SCHEMA },
  { id: "keyboard.palette.open", version: 1, title: "Open Key Bindings", description: "Open workspace key bindings command list.", category: "direct", surfaces: { keyboard: true, palette: true, coordinator: true }, paramsJsonSchema: EMPTY_PARAMS_JSON_SCHEMA },
  { id: "keyboard.leader.send", version: 1, title: "Send Leader", description: "Send literal leader sequence to focused panel.", category: "direct", surfaces: { keyboard: true, palette: true, coordinator: true }, paramsJsonSchema: EMPTY_PARAMS_JSON_SCHEMA },
  { id: "keyboard.mode.cancel", version: 1, title: "Cancel Keyboard Mode", description: "Cancel active keyboard mode and lightweight overlays.", category: "direct", surfaces: { keyboard: true, palette: true, coordinator: true }, paramsJsonSchema: EMPTY_PARAMS_JSON_SCHEMA },
  { id: "pane.split.down", version: 1, title: "Split Pane Down", description: "Split focused pane downward.", category: "direct", surfaces: { keyboard: true, palette: true, coordinator: true }, paramsJsonSchema: EMPTY_PARAMS_JSON_SCHEMA },
  { id: "pane.split.right", version: 1, title: "Split Pane Right", description: "Split focused pane to the right.", category: "direct", surfaces: { keyboard: true, palette: true, coordinator: true }, paramsJsonSchema: EMPTY_PARAMS_JSON_SCHEMA },
  { id: "pane.split.down.full", version: 1, title: "Split Window Down", description: "Split active window into full top/bottom regions.", category: "direct", surfaces: { keyboard: true, palette: true, coordinator: true }, paramsJsonSchema: EMPTY_PARAMS_JSON_SCHEMA },
  { id: "pane.split.right.full", version: 1, title: "Split Window Right", description: "Split active window into full left/right regions.", category: "direct", surfaces: { keyboard: true, palette: true, coordinator: true }, paramsJsonSchema: EMPTY_PARAMS_JSON_SCHEMA },
  { id: "pane.close", version: 1, title: "Close Pane", description: "Close focused workspace pane.", category: "direct", surfaces: { keyboard: true, palette: true, coordinator: true }, paramsJsonSchema: EMPTY_PARAMS_JSON_SCHEMA },
  { id: "pane.zoom.toggle", version: 1, title: "Toggle Expand", description: "Toggle expand for focused workspace pane.", category: "direct", surfaces: { keyboard: true, palette: true, coordinator: true }, paramsJsonSchema: EMPTY_PARAMS_JSON_SCHEMA },
  { id: "pane.focus.next", version: 1, title: "Focus Next Pane", description: "Focus next pane in traversal order.", category: "direct", surfaces: { keyboard: true, palette: true, coordinator: true }, paramsJsonSchema: EMPTY_PARAMS_JSON_SCHEMA },
  { id: "pane.focus.last", version: 1, title: "Focus Last Pane", description: "Focus previously focused pane.", category: "direct", surfaces: { keyboard: true, palette: true, coordinator: true }, paramsJsonSchema: EMPTY_PARAMS_JSON_SCHEMA },
  { id: "pane.focus.left", version: 1, title: "Focus Pane Left", description: "Focus pane to the left of current pane.", category: "direct", surfaces: { keyboard: true, palette: true, coordinator: true }, paramsJsonSchema: EMPTY_PARAMS_JSON_SCHEMA },
  { id: "pane.focus.right", version: 1, title: "Focus Pane Right", description: "Focus pane to the right of current pane.", category: "direct", surfaces: { keyboard: true, palette: true, coordinator: true }, paramsJsonSchema: EMPTY_PARAMS_JSON_SCHEMA },
  { id: "pane.focus.up", version: 1, title: "Focus Pane Up", description: "Focus pane above current pane.", category: "direct", surfaces: { keyboard: true, palette: true, coordinator: true }, paramsJsonSchema: EMPTY_PARAMS_JSON_SCHEMA },
  { id: "pane.focus.down", version: 1, title: "Focus Pane Down", description: "Focus pane below current pane.", category: "direct", surfaces: { keyboard: true, palette: true, coordinator: true }, paramsJsonSchema: EMPTY_PARAMS_JSON_SCHEMA },
  { id: "pane.number_mode.open", version: 1, title: "Open Pane Number Mode", description: "Open pane number chooser mode.", category: "direct", surfaces: { keyboard: true, palette: true, coordinator: true }, paramsJsonSchema: EMPTY_PARAMS_JSON_SCHEMA },
  { id: "pane.swap.prev", version: 1, title: "Swap With Previous Pane", description: "Swap focused pane with previous pane.", category: "direct", surfaces: { keyboard: true, palette: true, coordinator: true }, paramsJsonSchema: EMPTY_PARAMS_JSON_SCHEMA },
  { id: "pane.swap.next", version: 1, title: "Swap With Next Pane", description: "Swap focused pane with next pane.", category: "direct", surfaces: { keyboard: true, palette: true, coordinator: true }, paramsJsonSchema: EMPTY_PARAMS_JSON_SCHEMA },
  { id: "pane.rotate", version: 1, title: "Rotate Panes", description: "Rotate panes in traversal order.", category: "direct", surfaces: { keyboard: true, palette: true, coordinator: true }, paramsJsonSchema: EMPTY_PARAMS_JSON_SCHEMA },
  { id: "pane.break_to_window", version: 1, title: "Break Pane To Window", description: "Break focused pane into a new window.", category: "direct", surfaces: { keyboard: true, palette: true, coordinator: true }, paramsJsonSchema: EMPTY_PARAMS_JSON_SCHEMA },
  { id: "pane.resize.left", version: 1, title: "Resize Pane Left", description: "Resize focused pane toward left.", category: "direct", surfaces: { keyboard: true, palette: true, coordinator: true }, paramsJsonSchema: EMPTY_PARAMS_JSON_SCHEMA },
  { id: "pane.resize.right", version: 1, title: "Resize Pane Right", description: "Resize focused pane toward right.", category: "direct", surfaces: { keyboard: true, palette: true, coordinator: true }, paramsJsonSchema: EMPTY_PARAMS_JSON_SCHEMA },
  { id: "pane.resize.up", version: 1, title: "Resize Pane Up", description: "Resize focused pane toward top.", category: "direct", surfaces: { keyboard: true, palette: true, coordinator: true }, paramsJsonSchema: EMPTY_PARAMS_JSON_SCHEMA },
  { id: "pane.resize.down", version: 1, title: "Resize Pane Down", description: "Resize focused pane toward bottom.", category: "direct", surfaces: { keyboard: true, palette: true, coordinator: true }, paramsJsonSchema: EMPTY_PARAMS_JSON_SCHEMA },
  { id: "pane.type.prev", version: 1, title: "Previous Panel Type", description: "Switch focused pane to previous registered panel type.", category: "direct", surfaces: { keyboard: true, palette: true, coordinator: true }, paramsJsonSchema: EMPTY_PARAMS_JSON_SCHEMA },
  { id: "pane.type.next", version: 1, title: "Next Panel Type", description: "Switch focused pane to next registered panel type.", category: "direct", surfaces: { keyboard: true, palette: true, coordinator: true }, paramsJsonSchema: EMPTY_PARAMS_JSON_SCHEMA },
  { id: "pane.agent_view.prev", version: 1, title: "Previous Agent View", description: "Switch focused agent-detail pane to previous internal view.", category: "direct", surfaces: { keyboard: true, palette: true, coordinator: true }, paramsJsonSchema: EMPTY_PARAMS_JSON_SCHEMA },
  { id: "pane.agent_view.next", version: 1, title: "Next Agent View", description: "Switch focused agent-detail pane to next internal view.", category: "direct", surfaces: { keyboard: true, palette: true, coordinator: true }, paramsJsonSchema: EMPTY_PARAMS_JSON_SCHEMA },
  { id: "window.create", version: 1, title: "Create Window", description: "Create and activate new workspace window.", category: "direct", surfaces: { keyboard: true, palette: true, coordinator: true }, paramsJsonSchema: EMPTY_PARAMS_JSON_SCHEMA },
  { id: "window.close", version: 1, title: "Close Window", description: "Close active workspace window.", category: "direct", surfaces: { keyboard: true, palette: true, coordinator: true }, paramsJsonSchema: EMPTY_PARAMS_JSON_SCHEMA },
  { id: "window.rename", version: 1, title: "Rename Window", description: "Open active workspace window rename flow.", category: "direct", surfaces: { keyboard: true, palette: true, coordinator: true }, paramsJsonSchema: EMPTY_PARAMS_JSON_SCHEMA },
  { id: "window.next", version: 1, title: "Next Window", description: "Activate next workspace window.", category: "direct", surfaces: { keyboard: true, palette: true, coordinator: true }, paramsJsonSchema: EMPTY_PARAMS_JSON_SCHEMA },
  { id: "window.prev", version: 1, title: "Previous Window", description: "Activate previous workspace window.", category: "direct", surfaces: { keyboard: true, palette: true, coordinator: true }, paramsJsonSchema: EMPTY_PARAMS_JSON_SCHEMA },
  { id: "window.last", version: 1, title: "Last Window", description: "Activate last active workspace window.", category: "direct", surfaces: { keyboard: true, palette: true, coordinator: true }, paramsJsonSchema: EMPTY_PARAMS_JSON_SCHEMA },
  { id: "window.switcher.open", version: 1, title: "Open Window Switcher", description: "Open workspace window switcher.", category: "direct", surfaces: { keyboard: true, palette: true, coordinator: true }, paramsJsonSchema: EMPTY_PARAMS_JSON_SCHEMA },
  { id: "window.select_index", version: 1, title: "Select Window By Index", description: "Activate workspace window by index.", category: "parameterized", surfaces: { keyboard: true, palette: false, coordinator: true }, paramsJsonSchema: { type: "object", additionalProperties: false, required: ["index"], properties: { index: { type: "integer", minimum: 0, maximum: 9 } } } },
  { id: "layout.cycle", version: 1, title: "Cycle Layout", description: "Cycle practical workspace layouts.", category: "direct", surfaces: { keyboard: true, palette: true, coordinator: true }, paramsJsonSchema: EMPTY_PARAMS_JSON_SCHEMA },
  { id: "layout.equalize", version: 1, title: "Equalize Layout", description: "Equalize workspace split ratios.", category: "direct", surfaces: { keyboard: true, palette: true, coordinator: true }, paramsJsonSchema: EMPTY_PARAMS_JSON_SCHEMA },
  { id: "workspace.sessions_panel.toggle", version: 1, title: "Toggle Sessions Panel", description: "Toggle workspace sessions side panel.", category: "direct", surfaces: { keyboard: true, palette: true, coordinator: true }, paramsJsonSchema: EMPTY_PARAMS_JSON_SCHEMA },
  { id: "workspace.sessions_panel.focus_filter", version: 1, title: "Focus Sessions Filter", description: "Focus workspace sessions panel filter input.", category: "direct", surfaces: { keyboard: true, palette: true, coordinator: true }, paramsJsonSchema: EMPTY_PARAMS_JSON_SCHEMA },
  { id: "workspace.collapsibles.toggle_all", version: 1, title: "Toggle All Collapsibles", description: "Toggle all collapsible tool-call sections.", category: "direct", surfaces: { keyboard: true, palette: true, coordinator: true }, paramsJsonSchema: EMPTY_PARAMS_JSON_SCHEMA },
  { id: "workspace.coordinator.open", version: 1, title: "Open Coordinator", description: "Open coordinator dialog from workspace.", category: "direct", surfaces: { keyboard: true, palette: true, coordinator: true }, paramsJsonSchema: EMPTY_PARAMS_JSON_SCHEMA },
  { id: "workspace.stream.cancel", version: 1, title: "Cancel Stream", description: "Cancel active stream in focused workspace panel.", category: "direct", surfaces: { keyboard: true, palette: true, coordinator: true }, paramsJsonSchema: EMPTY_PARAMS_JSON_SCHEMA },
  { id: "settings.open.general", version: 1, title: "Open General Settings", description: "Navigate to settings general page from workspace commands.", category: "direct", surfaces: { keyboard: true, palette: true, coordinator: true }, paramsJsonSchema: EMPTY_PARAMS_JSON_SCHEMA },
  { id: "settings.open.images", version: 1, title: "Open Images Settings", description: "Navigate to settings images page from workspace commands.", category: "direct", surfaces: { keyboard: true, palette: true, coordinator: true }, paramsJsonSchema: EMPTY_PARAMS_JSON_SCHEMA },
  { id: "settings.open.keybindings", version: 1, title: "Open Keybindings Settings", description: "Navigate to settings keybindings page from workspace commands.", category: "direct", surfaces: { keyboard: true, palette: true, coordinator: true }, paramsJsonSchema: EMPTY_PARAMS_JSON_SCHEMA },
] as const);

export type UiActionId = (typeof UI_ACTIONS)[number]["id"];

export const UI_ACTION_IDS = UI_ACTIONS.map((action) => action.id) as readonly UiActionId[];

const UI_ACTIONS_BY_ID = new Map<UiActionId, (typeof UI_ACTIONS)[number]>(
  UI_ACTIONS.map((action) => [action.id, action]),
);

export function getUiActionDescriptor<TActionId extends UiActionId>(
  actionId: TActionId,
): Extract<(typeof UI_ACTIONS)[number], { readonly id: TActionId }> {
  const descriptor = UI_ACTIONS_BY_ID.get(actionId);
  if (!descriptor) throw new Error(`Unknown UI action descriptor: ${actionId}`);
  return descriptor as Extract<(typeof UI_ACTIONS)[number], { readonly id: TActionId }>;
}

export function isUiActionId(value: unknown): value is UiActionId {
  return typeof value === "string" && UI_ACTIONS_BY_ID.has(value as UiActionId);
}

export function assertUiActionIdsMatch(input: {
  readonly implementedActionIds: readonly string[];
  readonly source: string;
}): void {
  const declared = new Set<string>(UI_ACTION_IDS);
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
  for (const actionId of UI_ACTION_IDS) {
    if (!implemented.has(actionId)) missing.push(actionId);
  }

  if (duplicateImplemented.length === 0 && unknownImplemented.length === 0 && missing.length === 0) {
    return;
  }

  const problems: string[] = [];
  if (missing.length > 0) problems.push(`missing=[${missing.join(", ")}]`);
  if (unknownImplemented.length > 0) problems.push(`unknown=[${unknownImplemented.join(", ")}]`);
  if (duplicateImplemented.length > 0) problems.push(`duplicates=[${duplicateImplemented.join(", ")}]`);

  throw new Error(`UI action contract mismatch for ${input.source}: ${problems.join("; ")}`);
}

export function formatUiActionIdBullets(input?: {
  readonly surface?: keyof UiActionSurfaces;
}): string {
  const surface = input?.surface;
  return UI_ACTIONS.filter((action) => (surface ? action.surfaces[surface] : true))
    .map((action) => `- \`${action.id}\``)
    .join("\n");
}
