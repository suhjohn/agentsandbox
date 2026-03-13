import type {
  WorkspaceCustomKeybinding,
  WorkspaceKeyChord,
  WorkspaceKeybinding,
  WorkspaceKeybindingOverrides,
  WorkspaceReservedChord,
} from "./types";
import { createKeyChord, createKeySequence } from "./types";

export const DEFAULT_PREFIX_TIMEOUT_MS = 1000;

export const DEFAULT_LEADER_CHORD = createKeyChord({
  code: "KeyB",
  ctrl: true,
});

export const DEFAULT_LEADER_SEQUENCE = createKeySequence(DEFAULT_LEADER_CHORD);

function chord(
  code: string,
  modifiers?: {
    readonly ctrl?: boolean;
    readonly meta?: boolean;
    readonly alt?: boolean;
    readonly shift?: boolean;
  },
): WorkspaceKeyChord {
  return createKeyChord({
    code,
    ctrl: modifiers?.ctrl,
    meta: modifiers?.meta,
    alt: modifiers?.alt,
    shift: modifiers?.shift,
  });
}

function binding(input: {
  readonly id: string;
  readonly context: WorkspaceKeybinding["context"];
  readonly actionId: WorkspaceKeybinding["actionId"];
  readonly code: string;
  readonly params?: unknown;
  readonly ctrl?: boolean;
  readonly meta?: boolean;
  readonly alt?: boolean;
  readonly shift?: boolean;
}): WorkspaceKeybinding {
  return {
    id: input.id,
    context: input.context,
    actionId: input.actionId,
    sequence: createKeySequence(
      chord(input.code, {
        ctrl: input.ctrl,
        meta: input.meta,
        alt: input.alt,
        shift: input.shift,
      }),
    ),
    params: input.params,
    source: "default",
  };
}

const DEFAULT_BINDINGS: readonly WorkspaceKeybinding[] = [
  binding({
    id: "workspace.mode.cancel.escape",
    context: "workspace",
    actionId: "keyboard.mode.cancel",
    code: "Escape",
  }),
  binding({
    id: "workspace.keyboard.palette.open.meta",
    context: "workspace",
    actionId: "keyboard.palette.open",
    code: "KeyK",
    meta: true,
  }),
  binding({
    id: "workspace.keyboard.palette.open.ctrl",
    context: "workspace",
    actionId: "keyboard.palette.open",
    code: "KeyK",
    ctrl: true,
  }),
  binding({
    id: "workspace.collapsibles.toggle_all.meta",
    context: "workspace",
    actionId: "workspace.collapsibles.toggle_all",
    code: "KeyO",
    meta: true,
  }),
  binding({
    id: "workspace.collapsibles.toggle_all.ctrl",
    context: "workspace",
    actionId: "workspace.collapsibles.toggle_all",
    code: "KeyO",
    ctrl: true,
  }),
  binding({
    id: "workspace.pane_number.mode.cancel.escape",
    context: "workspace.pane_number",
    actionId: "keyboard.mode.cancel",
    code: "Escape",
  }),
  binding({
    id: "workspace.prefix.keyboard.help.open",
    context: "workspace.prefix",
    actionId: "keyboard.help.open",
    code: "Slash",
    shift: true,
  }),
  binding({
    id: "workspace.prefix.keyboard.palette.open",
    context: "workspace.prefix",
    actionId: "keyboard.palette.open",
    code: "Semicolon",
    shift: true,
  }),
  binding({
    id: "workspace.prefix.keyboard.palette.open.meta",
    context: "workspace.prefix",
    actionId: "keyboard.palette.open",
    code: "KeyK",
    meta: true,
  }),
  binding({
    id: "workspace.prefix.keyboard.palette.open.ctrl",
    context: "workspace.prefix",
    actionId: "keyboard.palette.open",
    code: "KeyK",
    ctrl: true,
  }),
  binding({
    id: "workspace.prefix.keyboard.leader.send",
    context: "workspace.prefix",
    actionId: "keyboard.leader.send",
    code: "KeyB",
    ctrl: true,
  }),
  binding({
    id: "workspace.prefix.pane.split.down",
    context: "workspace.prefix",
    actionId: "pane.split.down",
    code: "Quote",
    shift: true,
  }),
  binding({
    id: "workspace.prefix.pane.split.right",
    context: "workspace.prefix",
    actionId: "pane.split.right",
    code: "Digit5",
    shift: true,
  }),
  binding({
    id: "workspace.prefix.pane.split.down.full",
    context: "workspace.prefix",
    actionId: "pane.split.down.full",
    code: "Minus",
    shift: true,
  }),
  binding({
    id: "workspace.prefix.pane.split.right.full",
    context: "workspace.prefix",
    actionId: "pane.split.right.full",
    code: "Backslash",
    shift: true,
  }),
  binding({
    id: "workspace.prefix.pane.close",
    context: "workspace.prefix",
    actionId: "pane.close",
    code: "KeyX",
  }),
  binding({
    id: "workspace.prefix.pane.zoom.toggle",
    context: "workspace.prefix",
    actionId: "pane.zoom.toggle",
    code: "KeyZ",
  }),
  binding({
    id: "workspace.prefix.pane.focus.next",
    context: "workspace.prefix",
    actionId: "pane.focus.next",
    code: "KeyO",
  }),
  binding({
    id: "workspace.prefix.pane.focus.last",
    context: "workspace.prefix",
    actionId: "pane.focus.last",
    code: "Semicolon",
  }),
  binding({
    id: "workspace.prefix.pane.focus.left.vim",
    context: "workspace.prefix",
    actionId: "pane.focus.left",
    code: "KeyH",
  }),
  binding({
    id: "workspace.prefix.pane.focus.up.arrow",
    context: "workspace.prefix",
    actionId: "pane.focus.up",
    code: "ArrowUp",
  }),
  binding({
    id: "workspace.prefix.pane.focus.up.vim",
    context: "workspace.prefix",
    actionId: "pane.focus.up",
    code: "KeyK",
  }),
  binding({
    id: "workspace.prefix.pane.focus.down.arrow",
    context: "workspace.prefix",
    actionId: "pane.focus.down",
    code: "ArrowDown",
  }),
  binding({
    id: "workspace.prefix.pane.focus.down.vim",
    context: "workspace.prefix",
    actionId: "pane.focus.down",
    code: "KeyJ",
  }),
  binding({
    id: "workspace.prefix.pane.number_mode.open",
    context: "workspace.prefix",
    actionId: "pane.number_mode.open",
    code: "KeyQ",
  }),
  binding({
    id: "workspace.prefix.pane.swap.prev",
    context: "workspace.prefix",
    actionId: "pane.swap.prev",
    code: "BracketLeft",
    shift: true,
  }),
  binding({
    id: "workspace.prefix.pane.swap.next",
    context: "workspace.prefix",
    actionId: "pane.swap.next",
    code: "BracketRight",
    shift: true,
  }),
  binding({
    id: "workspace.prefix.pane.rotate",
    context: "workspace.prefix",
    actionId: "pane.rotate",
    code: "KeyO",
    ctrl: true,
  }),
  binding({
    id: "workspace.prefix.pane.break_to_window",
    context: "workspace.prefix",
    actionId: "pane.break_to_window",
    code: "Digit1",
    shift: true,
  }),
  binding({
    id: "workspace.prefix.pane.resize.left",
    context: "workspace.prefix",
    actionId: "pane.resize.left",
    code: "ArrowLeft",
    ctrl: true,
  }),
  binding({
    id: "workspace.prefix.pane.resize.right",
    context: "workspace.prefix",
    actionId: "pane.resize.right",
    code: "ArrowRight",
    ctrl: true,
  }),
  binding({
    id: "workspace.prefix.pane.resize.up",
    context: "workspace.prefix",
    actionId: "pane.resize.up",
    code: "ArrowUp",
    ctrl: true,
  }),
  binding({
    id: "workspace.prefix.pane.resize.down",
    context: "workspace.prefix",
    actionId: "pane.resize.down",
    code: "ArrowDown",
    ctrl: true,
  }),
  binding({
    id: "workspace.prefix.pane.type.prev",
    context: "workspace.prefix",
    actionId: "pane.type.prev",
    code: "ArrowLeft",
  }),
  binding({
    id: "workspace.prefix.pane.type.next",
    context: "workspace.prefix",
    actionId: "pane.type.next",
    code: "ArrowRight",
  }),
  binding({
    id: "workspace.prefix.pane.agent_view.prev",
    context: "workspace.prefix",
    actionId: "pane.agent_view.prev",
    code: "BracketLeft",
  }),
  binding({
    id: "workspace.prefix.pane.agent_view.next",
    context: "workspace.prefix",
    actionId: "pane.agent_view.next",
    code: "BracketRight",
  }),
  binding({
    id: "workspace.prefix.window.create",
    context: "workspace.prefix",
    actionId: "window.create",
    code: "KeyC",
  }),
  binding({
    id: "workspace.prefix.window.close",
    context: "workspace.prefix",
    actionId: "window.close",
    code: "Digit7",
    shift: true,
  }),
  binding({
    id: "workspace.prefix.window.rename",
    context: "workspace.prefix",
    actionId: "window.rename",
    code: "Comma",
  }),
  binding({
    id: "workspace.prefix.window.next",
    context: "workspace.prefix",
    actionId: "window.next",
    code: "KeyN",
  }),
  binding({
    id: "workspace.prefix.window.prev",
    context: "workspace.prefix",
    actionId: "window.prev",
    code: "KeyP",
  }),
  binding({
    id: "workspace.prefix.window.last",
    context: "workspace.prefix",
    actionId: "window.last",
    code: "KeyL",
  }),
  binding({
    id: "workspace.prefix.window.switcher.open",
    context: "workspace.prefix",
    actionId: "window.switcher.open",
    code: "KeyW",
  }),
  binding({
    id: "workspace.prefix.layout.cycle",
    context: "workspace.prefix",
    actionId: "layout.cycle",
    code: "Space",
  }),
  binding({
    id: "workspace.prefix.layout.equalize",
    context: "workspace.prefix",
    actionId: "layout.equalize",
    code: "Equal",
  }),
  binding({
    id: "workspace.prefix.workspace.sessions_panel.toggle",
    context: "workspace.prefix",
    actionId: "workspace.sessions_panel.toggle",
    code: "KeyS",
  }),
  binding({
    id: "workspace.prefix.workspace.sessions_panel.focus_filter",
    context: "workspace.prefix",
    actionId: "workspace.sessions_panel.focus_filter",
    code: "KeyF",
  }),
  binding({
    id: "workspace.prefix.workspace.coordinator.open",
    context: "workspace.prefix",
    actionId: "workspace.coordinator.open",
    code: "KeyE",
  }),
  binding({
    id: "workspace.prefix.workspace.stream.cancel",
    context: "workspace.prefix",
    actionId: "workspace.stream.cancel",
    code: "Escape",
  }),
  ...Array.from({ length: 10 }, (_, index) =>
    binding({
      id: `workspace.prefix.window.select_index.${index}`,
      context: "workspace.prefix",
      actionId: "window.select_index",
      code: `Digit${index}`,
      params: { index },
    })),
] as const;

const RESERVED_GLOBAL_CHORDS: readonly WorkspaceReservedChord[] = [
  {
    id: "global.reserved.coordinator.toggle",
    description: "Reserved for coordinator dialog toggle.",
    sequence: createKeySequence(chord("Space", { alt: true })),
  },
  {
    id: "global.reserved.coordinator.new_chat",
    description: "Reserved for coordinator new chat.",
    sequence: createKeySequence(chord("Space", { alt: true, shift: true })),
  },
  {
    id: "global.reserved.coordinator.sessions_list",
    description: "Reserved for coordinator sessions list.",
    sequence: createKeySequence(chord("KeyL", { alt: true, shift: true })),
  },
  {
    id: "global.reserved.coordinator.ptt.meta",
    description: "Reserved for coordinator push-to-talk.",
    sequence: createKeySequence(chord("Period", { meta: true })),
  },
  {
    id: "global.reserved.coordinator.ptt.ctrl",
    description: "Reserved for coordinator push-to-talk.",
    sequence: createKeySequence(chord("Period", { ctrl: true })),
  },
] as const;

export const DEFAULT_WORKSPACE_KEYBINDINGS = DEFAULT_BINDINGS;

export const DEFAULT_RESERVED_GLOBAL_CHORDS = RESERVED_GLOBAL_CHORDS;

function toUserBinding(binding: WorkspaceCustomKeybinding): WorkspaceKeybinding {
  return {
    ...binding,
    sequence: binding.sequence.map((entry) => createKeyChord(entry)),
    source: "user",
  };
}

export function resolveWorkspaceKeybindings(
  overrides: WorkspaceKeybindingOverrides,
  defaults: readonly WorkspaceKeybinding[] = DEFAULT_WORKSPACE_KEYBINDINGS,
): WorkspaceKeybinding[] {
  const disabledDefaultIds = new Set(overrides.disabledDefaultBindingIds);
  const resolvedDefaults = defaults
    .filter((item) => !disabledDefaultIds.has(item.id))
    .map((item) => ({ ...item, source: "default" as const }));
  const resolvedCustom = overrides.customBindings.map((item) => toUserBinding(item));
  return [...resolvedDefaults, ...resolvedCustom];
}
