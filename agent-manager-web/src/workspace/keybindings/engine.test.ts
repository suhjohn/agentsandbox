import { describe, expect, it } from "bun:test";
import { createWorkspaceKeybindingEngine } from "./engine";
import { createKeyChord, createKeySequence, type KeyboardEventLike, type WorkspaceKeybinding } from "./types";

interface TestKeyboardEvent extends KeyboardEventLike {
  prevented: boolean;
  stopped: boolean;
}

function testEvent(input: {
  readonly code: string;
  readonly ctrl?: boolean;
  readonly meta?: boolean;
  readonly alt?: boolean;
  readonly shift?: boolean;
  readonly repeat?: boolean;
  readonly target?: EventTarget | null | { readonly tagName?: string };
}): TestKeyboardEvent {
  const event: TestKeyboardEvent = {
    code: input.code,
    ctrlKey: input.ctrl ?? false,
    metaKey: input.meta ?? false,
    altKey: input.alt ?? false,
    shiftKey: input.shift ?? false,
    repeat: input.repeat ?? false,
    target: (input.target ?? null) as EventTarget | null,
    defaultPrevented: false,
    prevented: false,
    stopped: false,
    preventDefault: () => {
      event.defaultPrevented = true;
      event.prevented = true;
    },
    stopPropagation: () => {
      event.stopped = true;
    },
  };
  return event;
}

function binding(input: {
  readonly id: string;
  readonly context: WorkspaceKeybinding["context"];
  readonly commandId: WorkspaceKeybinding["commandId"];
  readonly code: string;
  readonly ctrl?: boolean;
  readonly meta?: boolean;
  readonly alt?: boolean;
  readonly shift?: boolean;
}): WorkspaceKeybinding {
  return {
    id: input.id,
    context: input.context,
    commandId: input.commandId,
    sequence: createKeySequence(
      createKeyChord({
        code: input.code,
        ctrl: input.ctrl,
        meta: input.meta,
        alt: input.alt,
        shift: input.shift,
      }),
    ),
  };
}

describe("workspace/keybindings/engine", () => {
  it("enters prefix mode on Ctrl+b and executes prefix bindings", () => {
    const bindings: WorkspaceKeybinding[] = [
      binding({
        id: "prefix-pane-close",
        context: "workspace.prefix",
        commandId: "pane.close",
        code: "KeyX",
      }),
    ];
    const matched: string[] = [];
    const engine = createWorkspaceKeybindingEngine({
      getBindings: () => bindings,
      onBindingMatched: ({ binding: matchedBinding }) => matched.push(matchedBinding.commandId),
    });

    const leaderEvent = testEvent({ code: "KeyB", ctrl: true });
    const leaderResult = engine.handleKeyDown(leaderEvent);
    expect(leaderResult.handled).toBe(true);
    expect(leaderResult.reason).toBe("leader");
    expect(leaderEvent.prevented).toBe(true);
    expect(engine.getState().mode).toBe("prefix");

    const paneCloseEvent = testEvent({ code: "KeyX" });
    const paneCloseResult = engine.handleKeyDown(paneCloseEvent);
    expect(paneCloseResult.handled).toBe(true);
    expect(paneCloseResult.reason).toBe("binding");
    expect(paneCloseResult.binding?.commandId).toBe("pane.close");
    expect(matched).toEqual(["pane.close"]);
    expect(engine.getState().mode).toBe("idle");
  });

  it("notifies unknown prefix sequences and resets mode", () => {
    const unknownSequences: string[] = [];
    const engine = createWorkspaceKeybindingEngine({
      getBindings: () => [],
      onUnknownPrefix: (sequence) => {
        unknownSequences.push(sequence.map((entry) => entry.code).join(" "));
      },
    });

    engine.handleKeyDown(testEvent({ code: "KeyB", ctrl: true }));
    const unknownResult = engine.handleKeyDown(testEvent({ code: "KeyY" }));
    expect(unknownResult.handled).toBe(true);
    expect(unknownResult.reason).toBe("unknown-prefix");
    expect(unknownSequences).toEqual(["KeyB KeyY"]);
    expect(engine.getState().mode).toBe("idle");
  });

  it("ignores standalone modifier keys while prefix mode is active", () => {
    const unknownSequences: string[] = [];
    const matched: string[] = [];
    const bindings: WorkspaceKeybinding[] = [
      binding({
        id: "prefix-split-right",
        context: "workspace.prefix",
        commandId: "pane.split.right",
        code: "Digit5",
        shift: true,
      }),
    ];
    const engine = createWorkspaceKeybindingEngine({
      getBindings: () => bindings,
      onBindingMatched: ({ binding: matchedBinding }) =>
        matched.push(matchedBinding.commandId),
      onUnknownPrefix: (sequence) => {
        unknownSequences.push(sequence.map((entry) => entry.code).join(" "));
      },
    });

    engine.handleKeyDown(testEvent({ code: "KeyB", ctrl: true }));
    expect(engine.getState().mode).toBe("prefix");

    const modifierResult = engine.handleKeyDown(
      testEvent({ code: "ShiftLeft", shift: true }),
    );
    expect(modifierResult.handled).toBe(false);
    expect(modifierResult.reason).toBe("no-match");
    expect(engine.getState().mode).toBe("prefix");
    expect(unknownSequences).toEqual([]);

    const splitRightResult = engine.handleKeyDown(
      testEvent({ code: "Digit5", shift: true }),
    );
    expect(splitRightResult.handled).toBe(true);
    expect(splitRightResult.reason).toBe("binding");
    expect(splitRightResult.binding?.commandId).toBe("pane.split.right");
    expect(matched).toEqual(["pane.split.right"]);
    expect(engine.getState().mode).toBe("idle");
  });

  it("times out prefix mode and returns to idle", () => {
    let timeoutCallback: (() => void) | null = null;
    const engine = createWorkspaceKeybindingEngine({
      getBindings: () => [],
      setTimer: (callback) => {
        timeoutCallback = callback;
        return 1;
      },
      clearTimer: () => {
        timeoutCallback = null;
      },
      getPrefixTimeoutMs: () => 10,
    });

    engine.handleKeyDown(testEvent({ code: "KeyB", ctrl: true }));
    expect(engine.getState().mode).toBe("prefix");
    expect(timeoutCallback).not.toBeNull();

    timeoutCallback?.();
    expect(engine.getState().mode).toBe("idle");
  });

  it("ignores non-safe keys in editable targets by default", () => {
    const bindings: WorkspaceKeybinding[] = [
      binding({
        id: "workspace-pane-close",
        context: "workspace",
        commandId: "pane.close",
        code: "KeyX",
      }),
      binding({
        id: "workspace-mode-cancel",
        context: "workspace",
        commandId: "keyboard.mode.cancel",
        code: "Escape",
      }),
    ];
    const engine = createWorkspaceKeybindingEngine({
      getBindings: () => bindings,
    });

    const inputTarget = { tagName: "INPUT" };
    const closeEvent = testEvent({
      code: "KeyX",
      target: inputTarget,
    });
    const closeResult = engine.handleKeyDown(closeEvent);
    expect(closeResult.handled).toBe(false);
    expect(closeResult.reason).toBe("input");

    const escapeEvent = testEvent({
      code: "Escape",
      target: inputTarget,
    });
    const escapeResult = engine.handleKeyDown(escapeEvent);
    expect(escapeResult.handled).toBe(true);
    expect(escapeResult.reason).toBe("binding");
  });

  it("captures leader and prefix commands while focus is in editable targets", () => {
    const matched: string[] = [];
    const bindings: WorkspaceKeybinding[] = [
      binding({
        id: "prefix-pane-close",
        context: "workspace.prefix",
        commandId: "pane.close",
        code: "KeyX",
      }),
    ];
    const engine = createWorkspaceKeybindingEngine({
      getBindings: () => bindings,
      onBindingMatched: ({ binding: matchedBinding }) => matched.push(matchedBinding.commandId),
    });

    const inputTarget = { tagName: "TEXTAREA" };
    const leaderEvent = testEvent({
      code: "KeyB",
      ctrl: true,
      target: inputTarget,
    });
    const leaderResult = engine.handleKeyDown(leaderEvent);
    expect(leaderResult.handled).toBe(true);
    expect(leaderResult.reason).toBe("leader");
    expect(engine.getState().mode).toBe("prefix");

    const closeEvent = testEvent({
      code: "KeyX",
      target: inputTarget,
    });
    const closeResult = engine.handleKeyDown(closeEvent);
    expect(closeResult.handled).toBe(true);
    expect(closeResult.reason).toBe("binding");
    expect(closeResult.binding?.commandId).toBe("pane.close");
    expect(matched).toEqual(["pane.close"]);
    expect(engine.getState().mode).toBe("idle");
  });

  it("captures command palette chord while focus is in editable targets", () => {
    const matched: string[] = [];
    const bindings: WorkspaceKeybinding[] = [
      binding({
        id: "workspace-palette-open",
        context: "workspace",
        commandId: "keyboard.palette.open",
        code: "KeyK",
        meta: true,
      }),
    ];
    const engine = createWorkspaceKeybindingEngine({
      getBindings: () => bindings,
      onBindingMatched: ({ binding: matchedBinding }) => matched.push(matchedBinding.commandId),
    });

    const inputTarget = { tagName: "TEXTAREA" };
    const paletteEvent = testEvent({
      code: "KeyK",
      meta: true,
      target: inputTarget,
    });
    const paletteResult = engine.handleKeyDown(paletteEvent);
    expect(paletteResult.handled).toBe(true);
    expect(paletteResult.reason).toBe("binding");
    expect(paletteResult.binding?.commandId).toBe("keyboard.palette.open");
    expect(matched).toEqual(["keyboard.palette.open"]);
  });

  it("supports pane-number mode digit hooks", () => {
    const selectedPaneIndexes: number[] = [];
    const engine = createWorkspaceKeybindingEngine({
      getBindings: () => [],
      onPaneNumberInput: ({ index }) => selectedPaneIndexes.push(index),
    });

    engine.enterPaneNumberMode();
    const result = engine.handleKeyDown(testEvent({ code: "Digit3" }));
    expect(result.handled).toBe(true);
    expect(result.reason).toBe("pane-number");
    expect(selectedPaneIndexes).toEqual([3]);
    expect(engine.getState().mode).toBe("idle");
  });

  it("lets reserved chords pass through and cancels active modes", () => {
    const matched: string[] = [];
    const bindings: WorkspaceKeybinding[] = [
      binding({
        id: "global-conflicting",
        context: "global",
        commandId: "keyboard.help.open",
        code: "Space",
        alt: true,
      }),
    ];
    const engine = createWorkspaceKeybindingEngine({
      getBindings: () => bindings,
      getReservedChords: () => [
        {
          id: "reserved-toggle",
          description: "Reserved",
          sequence: createKeySequence(
            createKeyChord({
              code: "Space",
              alt: true,
            }),
          ),
        },
      ],
      onBindingMatched: ({ binding: matchedBinding }) => matched.push(matchedBinding.commandId),
    });

    engine.handleKeyDown(testEvent({ code: "KeyB", ctrl: true }));
    expect(engine.getState().mode).toBe("prefix");

    const reservedResult = engine.handleKeyDown(testEvent({ code: "Space", alt: true }));
    expect(reservedResult.handled).toBe(false);
    expect(reservedResult.reason).toBe("reserved");
    expect(matched).toEqual([]);
    expect(engine.getState().mode).toBe("idle");
  });
});
