import { describe, expect, it } from "bun:test";
import { createKeyChord, createKeySequence, formatKeyChord, formatKeySequence } from "./types";

describe("workspace/keybindings/types", () => {
  it("formats control chords with explicit modifier names", () => {
    expect(
      formatKeyChord(
        createKeyChord({
          code: "KeyB",
          ctrl: true,
        }),
      ),
    ).toBe("Ctrl+b");
  });

  it("formats multi-step sequences with readable modifier separators", () => {
    expect(
      formatKeySequence(
        createKeySequence(
          createKeyChord({
            code: "KeyB",
            ctrl: true,
          }),
          createKeyChord({
            code: "ArrowLeft",
            ctrl: true,
            shift: true,
          }),
        ),
      ),
    ).toBe("Ctrl+b Ctrl+Shift+Left");
  });
});
