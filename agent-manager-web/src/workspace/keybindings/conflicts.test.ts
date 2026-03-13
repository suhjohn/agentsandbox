import { describe, expect, it } from "bun:test";
import {
  findAllKeybindingConflicts,
  findBindingConflicts,
  findConflictsForBinding,
  findReservedChordConflicts,
} from "./conflicts";
import {
  createKeyChord,
  createKeySequence,
  type WorkspaceKeybinding,
  type WorkspaceReservedChord,
} from "./types";

function binding(input: {
  readonly id: string;
  readonly context: WorkspaceKeybinding["context"];
  readonly actionId: WorkspaceKeybinding["actionId"];
  readonly code: string;
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

describe("workspace/keybindings/conflicts", () => {
  it("detects conflicts for same context and sequence", () => {
    const bindings: WorkspaceKeybinding[] = [
      binding({
        id: "first",
        context: "workspace.prefix",
        actionId: "pane.close",
        code: "KeyX",
      }),
      binding({
        id: "second",
        context: "workspace.prefix",
        actionId: "pane.zoom.toggle",
        code: "KeyX",
      }),
    ];

    const conflicts = findBindingConflicts(bindings);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.kind).toBe("binding");
    expect(conflicts[0]?.context).toBe("workspace.prefix");
    expect(conflicts[0]?.actionIds.sort()).toEqual(["pane.close", "pane.zoom.toggle"]);
  });

  it("does not conflict when sequence matches in different contexts", () => {
    const bindings: WorkspaceKeybinding[] = [
      binding({
        id: "workspace-binding",
        context: "workspace",
        actionId: "pane.close",
        code: "KeyX",
      }),
      binding({
        id: "prefix-binding",
        context: "workspace.prefix",
        actionId: "pane.zoom.toggle",
        code: "KeyX",
      }),
    ];

    const conflicts = findBindingConflicts(bindings);
    expect(conflicts).toEqual([]);
  });

  it("detects reserved global chord collisions", () => {
    const bindings: WorkspaceKeybinding[] = [
      binding({
        id: "global-toggle",
        context: "global",
        actionId: "keyboard.palette.open",
        code: "KeyP",
        ctrl: true,
        shift: true,
      }),
    ];
    const reserved: WorkspaceReservedChord[] = [
      {
        id: "reserved.coordinator",
        description: "Coordinator toggle",
        sequence: createKeySequence(
          createKeyChord({
            code: "KeyP",
            ctrl: true,
            shift: true,
          }),
        ),
      },
    ];

    const conflicts = findReservedChordConflicts(bindings, reserved);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.kind).toBe("reserved");
    expect(conflicts[0]?.reservedChordId).toBe("reserved.coordinator");
  });

  it("includes candidate binding conflicts against existing bindings and reserved chords", () => {
    const existing: WorkspaceKeybinding[] = [
      binding({
        id: "existing-prefix",
        context: "workspace.prefix",
        actionId: "pane.close",
        code: "KeyX",
      }),
    ];
    const candidate = binding({
      id: "candidate",
      context: "workspace.prefix",
      actionId: "pane.zoom.toggle",
      code: "KeyX",
    });
    const reserved: WorkspaceReservedChord[] = [
      {
        id: "reserved.coordinator",
        description: "Coordinator toggle",
        sequence: createKeySequence(
          createKeyChord({
            code: "KeyX",
          }),
        ),
      },
    ];

    const candidateConflicts = findConflictsForBinding(candidate, existing, reserved);
    const allConflicts = findAllKeybindingConflicts([...existing, candidate], reserved);

    expect(candidateConflicts.length).toBeGreaterThan(0);
    expect(allConflicts.length).toBeGreaterThan(0);
    expect(candidateConflicts.some((item) => item.kind === "binding")).toBe(true);
  });
});
