export type KeybindingContext =
  | "global"
  | "workspace"
  | "workspace.prefix"
  | "workspace.pane_number"
  | `panel:${string}`;

export type WorkspaceCommandCategory =
  | "Keyboard"
  | "Panes"
  | "Windows"
  | "Layout"
  | "Workspace";

export type WorkspaceCommandId =
  | "keyboard.help.open"
  | "keyboard.palette.open"
  | "keyboard.leader.send"
  | "keyboard.mode.cancel"
  | "pane.split.down"
  | "pane.split.right"
  | "pane.split.down.full"
  | "pane.split.right.full"
  | "pane.close"
  | "pane.zoom.toggle"
  | "pane.focus.next"
  | "pane.focus.last"
  | "pane.focus.left"
  | "pane.focus.right"
  | "pane.focus.up"
  | "pane.focus.down"
  | "pane.number_mode.open"
  | "pane.swap.prev"
  | "pane.swap.next"
  | "pane.rotate"
  | "pane.break_to_window"
  | "pane.resize.left"
  | "pane.resize.right"
  | "pane.resize.up"
  | "pane.resize.down"
  | "window.create"
  | "window.close"
  | "window.rename"
  | "window.next"
  | "window.prev"
  | "window.last"
  | "window.switcher.open"
  | "window.select_index"
  | "layout.cycle"
  | "layout.equalize"
  | "workspace.sessions_panel.toggle"
  | "workspace.sessions_panel.focus_filter"
  | "workspace.collapsibles.toggle_all"
  | "workspace.coordinator.open"
  | "workspace.stream.cancel"
  | "settings.open.general"
  | "settings.open.images"
  | "settings.open.keybindings";

export interface WorkspaceKeyChord {
  readonly ctrl: boolean;
  readonly meta: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
  readonly code: string;
}

export type WorkspaceKeySequence = readonly WorkspaceKeyChord[];

export interface WorkspaceKeybinding {
  readonly id: string;
  readonly context: KeybindingContext;
  readonly sequence: WorkspaceKeySequence;
  readonly commandId: WorkspaceCommandId;
  readonly args?: unknown;
  readonly source?: "default" | "user";
}

export interface WorkspaceCustomKeybinding {
  readonly id: string;
  readonly context: KeybindingContext;
  readonly sequence: WorkspaceKeySequence;
  readonly commandId: WorkspaceCommandId;
  readonly args?: unknown;
}

export interface WorkspaceKeybindingOverrides {
  readonly leaderSequence?: WorkspaceKeySequence;
  readonly disabledDefaultBindingIds: readonly string[];
  readonly customBindings: readonly WorkspaceCustomKeybinding[];
}

export interface WorkspaceReservedChord {
  readonly id: string;
  readonly sequence: WorkspaceKeySequence;
  readonly description: string;
}

export interface WorkspaceCommandDefinition {
  readonly id: WorkspaceCommandId;
  readonly title: string;
  readonly description: string;
  readonly category: WorkspaceCommandCategory;
  readonly contexts: readonly KeybindingContext[];
  readonly repeatable?: boolean;
}

export interface KeyboardEventLike {
  readonly code: string;
  readonly key?: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
  readonly repeat?: boolean;
  readonly target?: EventTarget | null;
  readonly defaultPrevented?: boolean;
  preventDefault?: () => void;
  stopPropagation?: () => void;
}

export function isKeybindingContext(value: unknown): value is KeybindingContext {
  if (value === "global") return true;
  if (value === "workspace") return true;
  if (value === "workspace.prefix") return true;
  if (value === "workspace.pane_number") return true;
  return typeof value === "string" && value.startsWith("panel:");
}

export function createKeyChord(input: {
  readonly code: string;
  readonly ctrl?: boolean;
  readonly meta?: boolean;
  readonly alt?: boolean;
  readonly shift?: boolean;
}): WorkspaceKeyChord {
  return {
    code: input.code,
    ctrl: input.ctrl ?? false,
    meta: input.meta ?? false,
    alt: input.alt ?? false,
    shift: input.shift ?? false,
  };
}

export function createKeySequence(...chords: readonly WorkspaceKeyChord[]): WorkspaceKeySequence {
  return chords.map((chord) => createKeyChord(chord));
}

export function keyChordFromEvent(event: KeyboardEventLike): WorkspaceKeyChord {
  return createKeyChord({
    code: event.code,
    ctrl: event.ctrlKey,
    meta: event.metaKey,
    alt: event.altKey,
    shift: event.shiftKey,
  });
}

export function isKeyChord(value: unknown): value is WorkspaceKeyChord {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.code === "string" &&
    typeof candidate.ctrl === "boolean" &&
    typeof candidate.meta === "boolean" &&
    typeof candidate.alt === "boolean" &&
    typeof candidate.shift === "boolean"
  );
}

export function isKeySequence(value: unknown): value is WorkspaceKeySequence {
  return Array.isArray(value) && value.every((item) => isKeyChord(item));
}

export function areKeyChordsEqual(a: WorkspaceKeyChord, b: WorkspaceKeyChord): boolean {
  return (
    a.code === b.code &&
    a.ctrl === b.ctrl &&
    a.meta === b.meta &&
    a.alt === b.alt &&
    a.shift === b.shift
  );
}

export function areKeySequencesEqual(a: WorkspaceKeySequence, b: WorkspaceKeySequence): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (!areKeyChordsEqual(a[index]!, b[index]!)) return false;
  }
  return true;
}

function isShiftEmbeddedCode(code: string): boolean {
  if (code.startsWith("Digit")) return true;
  return (
    code === "Backquote" ||
    code === "Minus" ||
    code === "Equal" ||
    code === "BracketLeft" ||
    code === "BracketRight" ||
    code === "Backslash" ||
    code === "Semicolon" ||
    code === "Quote" ||
    code === "Comma" ||
    code === "Period" ||
    code === "Slash"
  );
}

function codeToDisplayKey(code: string, shift: boolean): string {
  if (code.startsWith("Key") && code.length === 4) {
    const letter = code.slice(3).toLowerCase();
    return shift ? letter.toUpperCase() : letter;
  }

  if (code.startsWith("Digit") && code.length === 6) {
    const digit = code.slice(5);
    if (!shift) return digit;
    const shiftedDigitMap: Record<string, string> = {
      "0": ")",
      "1": "!",
      "2": "@",
      "3": "#",
      "4": "$",
      "5": "%",
      "6": "^",
      "7": "&",
      "8": "*",
      "9": "(",
    };
    return shiftedDigitMap[digit] ?? digit;
  }

  if (code.startsWith("Numpad") && code.length === 7) {
    return code.slice(6);
  }

  const punctuationMap: Record<string, { readonly base: string; readonly shifted: string }> = {
    Backquote: { base: "`", shifted: "~" },
    Minus: { base: "-", shifted: "_" },
    Equal: { base: "=", shifted: "+" },
    BracketLeft: { base: "[", shifted: "{" },
    BracketRight: { base: "]", shifted: "}" },
    Backslash: { base: "\\", shifted: "|" },
    Semicolon: { base: ";", shifted: ":" },
    Quote: { base: "'", shifted: '"' },
    Comma: { base: ",", shifted: "<" },
    Period: { base: ".", shifted: ">" },
    Slash: { base: "/", shifted: "?" },
  };
  const punctuation = punctuationMap[code];
  if (punctuation) return shift ? punctuation.shifted : punctuation.base;

  const specialMap: Record<string, string> = {
    Space: "Space",
    Tab: "Tab",
    Enter: "Enter",
    Escape: "Escape",
    Backspace: "Backspace",
    Delete: "Delete",
    ArrowLeft: "Left",
    ArrowRight: "Right",
    ArrowUp: "Up",
    ArrowDown: "Down",
    Home: "Home",
    End: "End",
    PageUp: "PageUp",
    PageDown: "PageDown",
  };
  return specialMap[code] ?? code;
}

export function formatKeyChord(chord: WorkspaceKeyChord): string {
  const modifierParts: string[] = [];
  if (chord.ctrl) modifierParts.push("Ctrl");
  if (chord.alt) modifierParts.push("Alt");
  if (chord.meta) modifierParts.push("Cmd");

  const keyLabel = codeToDisplayKey(chord.code, chord.shift);
  const includeShiftModifier = chord.shift && !isShiftEmbeddedCode(chord.code);
  if (includeShiftModifier) modifierParts.push("Shift");

  modifierParts.push(keyLabel);
  return modifierParts.join("+");
}

export function formatKeySequence(sequence: WorkspaceKeySequence): string {
  return sequence.map((chord) => formatKeyChord(chord)).join(" ");
}

export function serializeKeyChord(chord: WorkspaceKeyChord): string {
  return [
    chord.ctrl ? "1" : "0",
    chord.meta ? "1" : "0",
    chord.alt ? "1" : "0",
    chord.shift ? "1" : "0",
    chord.code,
  ].join(":");
}

export function serializeKeySequence(sequence: WorkspaceKeySequence): string {
  return sequence.map((chord) => serializeKeyChord(chord)).join(",");
}

function hasEditableShape(
  target: EventTarget | null | undefined,
): target is EventTarget & { readonly tagName?: unknown; readonly isContentEditable?: unknown } {
  return typeof target === "object" && target !== null;
}

export function isEditableTarget(target: EventTarget | null | undefined): boolean {
  if (!hasEditableShape(target)) return false;

  if (target.isContentEditable === true) return true;

  const tagNameValue = target.tagName;
  if (typeof tagNameValue !== "string") return false;
  const normalizedTagName = tagNameValue.toLowerCase();
  return (
    normalizedTagName === "input" ||
    normalizedTagName === "textarea" ||
    normalizedTagName === "select"
  );
}

export function createEmptyKeybindingOverrides(): WorkspaceKeybindingOverrides {
  return {
    leaderSequence: undefined,
    disabledDefaultBindingIds: [],
    customBindings: [],
  };
}
