# Agent Session Header: Right Panel Dropdown

## Goal

Replace the `Terminal`, `Browser`, and `Diff` header buttons in the agent session panel with a single dropdown trigger. Selecting an item should open the corresponding panel in the right-side area.

## Behavior

1. Agent session header shows one dropdown action for opening side panels.
2. Dropdown options:
   - `Terminal`
   - `Browser`
   - `Diff`
3. Selecting an option uses the current session's `agentId` for panel config.
4. Open rules:
   - If no right-adjacent panel exists relative to the current session pane, open selected panel to the right.
   - If a right-adjacent panel already exists, keep it and split that panel vertically (`top/bottom`), placing the new panel in the bottom split.

## Implementation Notes

- Introduce `placement: "right-stack"` for `panel/open`.
- `right-stack` semantics in reducer:
  - Find right-adjacent leaf from source leaf.
  - If missing, split source leaf to the right (`row`) and place new panel in new right leaf.
  - If present, split that right-adjacent leaf downward (`col`) and place new panel in new bottom leaf.
- Keep existing `self`, `right`, and `bottom` behaviors unchanged.
