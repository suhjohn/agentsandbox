import {
  areKeyChordsEqual,
  areKeySequencesEqual,
  createKeyChord,
  createKeySequence,
  isEditableTarget,
  keyChordFromEvent,
  type KeyboardEventLike,
  type KeybindingContext,
  type WorkspaceKeySequence,
  type WorkspaceKeybinding,
  type WorkspaceReservedChord,
} from "./types";

export type WorkspaceKeybindingMode = "idle" | "prefix" | "pane_number";

export interface WorkspaceKeybindingEngineState {
  readonly mode: WorkspaceKeybindingMode;
  readonly prefixStartedAt: number | null;
}

export interface WorkspaceKeybindingEngineResult {
  readonly handled: boolean;
  readonly reason:
    | "binding"
    | "leader"
    | "pane-number"
    | "unknown-prefix"
    | "mode-cancel"
    | "reserved"
    | "input"
    | "no-match";
  readonly binding?: WorkspaceKeybinding;
}

export interface WorkspaceKeybindingEngineBindingMatch {
  readonly binding: WorkspaceKeybinding;
  readonly event: KeyboardEventLike;
  readonly mode: WorkspaceKeybindingMode;
}

export interface WorkspacePaneNumberInput {
  readonly index: number;
  readonly event: KeyboardEventLike;
}

export interface CreateWorkspaceKeybindingEngineOptions {
  readonly getBindings: () => readonly WorkspaceKeybinding[];
  readonly getReservedChords?: () => readonly WorkspaceReservedChord[];
  readonly getLeaderSequence?: () => WorkspaceKeySequence;
  readonly getPrefixTimeoutMs?: () => number;
  readonly isWorkspaceActive?: () => boolean;
  readonly getActivePanelContext?: () => `panel:${string}` | null;
  readonly captureInInput?: boolean;
  readonly isSafeInputChord?: (chord: ReturnType<typeof createKeyChord>) => boolean;
  readonly onBindingMatched?: (match: WorkspaceKeybindingEngineBindingMatch) => void;
  readonly onPaneNumberInput?: (event: WorkspacePaneNumberInput) => void;
  readonly onUnknownPrefix?: (sequence: WorkspaceKeySequence) => void;
  readonly onStateChange?: (state: WorkspaceKeybindingEngineState) => void;
  readonly now?: () => number;
  readonly setTimer?: (callback: () => void, timeoutMs: number) => unknown;
  readonly clearTimer?: (timerHandle: unknown) => void;
}

export interface WorkspaceKeybindingEngine {
  readonly getState: () => WorkspaceKeybindingEngineState;
  readonly handleKeyDown: (event: KeyboardEventLike) => WorkspaceKeybindingEngineResult;
  readonly cancelModes: () => void;
  readonly enterPaneNumberMode: () => void;
  readonly dispose: () => void;
}

const FALLBACK_LEADER_SEQUENCE = createKeySequence(
  createKeyChord({
    code: "KeyB",
    ctrl: true,
  }),
);

const MODIFIER_CODES = new Set([
  "ShiftLeft",
  "ShiftRight",
  "ControlLeft",
  "ControlRight",
  "AltLeft",
  "AltRight",
  "MetaLeft",
  "MetaRight",
]);
const EDITABLE_TARGET_ALLOWED_COMMAND_IDS = new Set(["keyboard.palette.open"]);

const INITIAL_STATE: WorkspaceKeybindingEngineState = {
  mode: "idle",
  prefixStartedAt: null,
};

function preventEventDefault(event: KeyboardEventLike): void {
  event.preventDefault?.();
  event.stopPropagation?.();
}

function isDigitChord(chord: ReturnType<typeof createKeyChord>): number | null {
  if (chord.ctrl || chord.meta || chord.alt) return null;

  if (chord.code.startsWith("Digit") && chord.code.length === 6) {
    const numeric = Number.parseInt(chord.code.slice(5), 10);
    if (Number.isFinite(numeric)) return numeric;
  }

  if (chord.code.startsWith("Numpad") && chord.code.length === 7) {
    const numeric = Number.parseInt(chord.code.slice(6), 10);
    if (Number.isFinite(numeric)) return numeric;
  }

  return null;
}

function isModifierOnlyChord(chord: ReturnType<typeof createKeyChord>): boolean {
  return MODIFIER_CODES.has(chord.code);
}

function findSingleChordBinding(
  bindings: readonly WorkspaceKeybinding[],
  contexts: readonly KeybindingContext[],
  chord: ReturnType<typeof createKeyChord>,
): WorkspaceKeybinding | null {
  for (const context of contexts) {
    for (const binding of bindings) {
      if (binding.context !== context) continue;
      if (binding.sequence.length !== 1) continue;
      if (!areKeyChordsEqual(binding.sequence[0]!, chord)) continue;
      return binding;
    }
  }
  return null;
}

function isChordReserved(
  chord: ReturnType<typeof createKeyChord>,
  reservedChords: readonly WorkspaceReservedChord[],
): boolean {
  return reservedChords.some(
    (reserved) => reserved.sequence.length === 1 && areKeyChordsEqual(reserved.sequence[0]!, chord),
  );
}

export function createWorkspaceKeybindingEngine(
  options: CreateWorkspaceKeybindingEngineOptions,
): WorkspaceKeybindingEngine {
  const getReservedChords = options.getReservedChords ?? (() => []);
  const getLeaderSequence = options.getLeaderSequence ?? (() => FALLBACK_LEADER_SEQUENCE);
  const getPrefixTimeoutMs = options.getPrefixTimeoutMs ?? (() => 1000);
  const isWorkspaceActive = options.isWorkspaceActive ?? (() => true);
  const now = options.now ?? (() => Date.now());
  const setTimer = options.setTimer ?? ((callback: () => void, timeoutMs: number) => setTimeout(callback, timeoutMs));
  const clearTimer = options.clearTimer ?? ((timerHandle: unknown) => clearTimeout(timerHandle as number));
  const isSafeInputChord = options.isSafeInputChord ?? ((chord) => chord.code === "Escape");

  let state: WorkspaceKeybindingEngineState = INITIAL_STATE;
  let prefixTimerHandle: unknown | null = null;

  function emitState(nextState: WorkspaceKeybindingEngineState): void {
    if (nextState.mode === state.mode && nextState.prefixStartedAt === state.prefixStartedAt) return;
    state = nextState;
    options.onStateChange?.(state);
  }

  function clearPrefixTimer(): void {
    if (prefixTimerHandle === null) return;
    clearTimer(prefixTimerHandle);
    prefixTimerHandle = null;
  }

  function cancelModesInternal(): void {
    clearPrefixTimer();
    emitState({
      mode: "idle",
      prefixStartedAt: null,
    });
  }

  function enterPrefixMode(): void {
    clearPrefixTimer();
    const startedAt = now();
    emitState({
      mode: "prefix",
      prefixStartedAt: startedAt,
    });
    prefixTimerHandle = setTimer(() => {
      prefixTimerHandle = null;
      if (state.mode !== "prefix") return;
      cancelModesInternal();
    }, getPrefixTimeoutMs());
  }

  function enterPaneNumberMode(): void {
    clearPrefixTimer();
    emitState({
      mode: "pane_number",
      prefixStartedAt: null,
    });
  }

  function getNormalContexts(): KeybindingContext[] {
    const contexts: KeybindingContext[] = ["global"];
    if (!isWorkspaceActive()) return contexts;
    contexts.push("workspace");
    const panelContext = options.getActivePanelContext?.();
    if (panelContext) contexts.push(panelContext);
    return contexts;
  }

  function shouldHandleEvent(event: KeyboardEventLike): boolean {
    if (options.captureInInput) return true;
    if (!isEditableTarget(event.target)) return true;
    const chord = keyChordFromEvent(event);
    if (isSafeInputChord(chord)) return true;
    // Leader should always be capturable from editable elements so prefix
    // commands work while focus stays in panel composers (e.g. textarea).
    if (areKeySequencesEqual([chord], getLeaderSequence())) return true;
    const binding = findSingleChordBinding(
      options.getBindings(),
      getNormalContexts(),
      chord,
    );
    return !!binding && EDITABLE_TARGET_ALLOWED_COMMAND_IDS.has(binding.commandId);
  }

  function executeBinding(
    binding: WorkspaceKeybinding,
    event: KeyboardEventLike,
    mode: WorkspaceKeybindingMode,
  ): WorkspaceKeybindingEngineResult {
    preventEventDefault(event);
    options.onBindingMatched?.({
      binding,
      event,
      mode,
    });
    return {
      handled: true,
      reason: "binding",
      binding,
    };
  }

  function handleIdleMode(event: KeyboardEventLike): WorkspaceKeybindingEngineResult {
    const chord = keyChordFromEvent(event);
    if (isWorkspaceActive() && areKeySequencesEqual([chord], getLeaderSequence())) {
      preventEventDefault(event);
      enterPrefixMode();
      return {
        handled: true,
        reason: "leader",
      };
    }

    const binding = findSingleChordBinding(options.getBindings(), getNormalContexts(), chord);
    if (!binding) {
      return {
        handled: false,
        reason: "no-match",
      };
    }

    return executeBinding(binding, event, "idle");
  }

  function handlePrefixMode(event: KeyboardEventLike): WorkspaceKeybindingEngineResult {
    const chord = keyChordFromEvent(event);
    if (isModifierOnlyChord(chord)) {
      return {
        handled: false,
        reason: "no-match",
      };
    }
    const binding = findSingleChordBinding(options.getBindings(), ["workspace.prefix"], chord);
    if (binding) {
      cancelModesInternal();
      return executeBinding(binding, event, "prefix");
    }

    preventEventDefault(event);
    const sequence = [...getLeaderSequence(), chord];
    cancelModesInternal();
    options.onUnknownPrefix?.(sequence);
    return {
      handled: true,
      reason: "unknown-prefix",
    };
  }

  function handlePaneNumberMode(event: KeyboardEventLike): WorkspaceKeybindingEngineResult {
    const chord = keyChordFromEvent(event);
    const paneModeBinding = findSingleChordBinding(
      options.getBindings(),
      ["workspace.pane_number"],
      chord,
    );
    if (paneModeBinding) {
      cancelModesInternal();
      return executeBinding(paneModeBinding, event, "pane_number");
    }

    const paneIndex = isDigitChord(chord);
    if (paneIndex !== null) {
      preventEventDefault(event);
      cancelModesInternal();
      options.onPaneNumberInput?.({ index: paneIndex, event });
      return {
        handled: true,
        reason: "pane-number",
      };
    }

    if (chord.code === "Escape") {
      preventEventDefault(event);
      cancelModesInternal();
      return {
        handled: true,
        reason: "mode-cancel",
      };
    }

    preventEventDefault(event);
    cancelModesInternal();
    return {
      handled: true,
      reason: "mode-cancel",
    };
  }

  function handleKeyDown(event: KeyboardEventLike): WorkspaceKeybindingEngineResult {
    if (event.defaultPrevented) {
      return {
        handled: false,
        reason: "no-match",
      };
    }

    const chord = keyChordFromEvent(event);
    if (isChordReserved(chord, getReservedChords())) {
      if (state.mode !== "idle") cancelModesInternal();
      return {
        handled: false,
        reason: "reserved",
      };
    }

    if (state.mode === "prefix") {
      return handlePrefixMode(event);
    }
    if (state.mode === "pane_number") {
      return handlePaneNumberMode(event);
    }

    if (!shouldHandleEvent(event)) {
      return {
        handled: false,
        reason: "input",
      };
    }

    return handleIdleMode(event);
  }

  return {
    getState: () => state,
    handleKeyDown,
    cancelModes: () => {
      cancelModesInternal();
    },
    enterPaneNumberMode: () => {
      enterPaneNumberMode();
    },
    dispose: () => {
      clearPrefixTimer();
    },
  };
}

export const WORKSPACE_KEYBINDING_ENGINE_INITIAL_STATE = INITIAL_STATE;
