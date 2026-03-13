# Workspace Keybindings Implementation Plan

This plan implements the tmux-style keyboard spec defined in `KEYBINDINGS.md`, including `Ctrl+b` leader mode, practical pane/window/layout commands, and full view/edit support for bindings.

## Objectives

- Ship a `Ctrl+b` prefix system with safe browser/input behavior.
- Support practical tmux-like commands for panes, windows, and layouts.
- Make all commands discoverable (`Ctrl+b ?`, `Ctrl+b :`) and user-modifiable.
- Consolidate scattered keyboard logic into one registry/engine.
- Persist keybinding overrides in user settings (`PATCH /users/me`) backed by nullable JSONB in `users.workspace_keybindings` (`null` means defaults/no overrides).
- Preserve existing global shortcuts (`Option/Alt+Space`, `Cmd/Ctrl+.`) without regression.

## Existing Global Shortcut Guardrails

Current global shortcuts in `agent-manager-web/src/routes/root.tsx`:

  - `Option/Alt+Space` → coordinator dialog toggle.
  - `Option/Alt+Shift+Space` → new coordinator chat (draft new session).
  - `Option/Alt+Shift+L` → coordinator sessions list.
  - `Cmd/Ctrl+.` (hold/release) → PTT start/stop.
  - `Cmd/Ctrl+ArrowUp` / `Cmd/Ctrl+ArrowDown` (while recording) → microphone cycle.

Implementation constraints:

- Treat these chords as reserved and non-overridable by default.
- Ensure workspace keymap dispatch skips these chords.
- Keep global behavior route-agnostic and unchanged by `Ctrl+b` prefix support.

## Phased Delivery

## Phase 1: Foundation + Initial Commands

- Add command registry + keybinding types/defaults.
- Add keyboard engine with prefix mode (`idle -> prefix -> execute/cancel`) and timeout HUD.
- Mount workspace keybinding host in workspace scope.
- Add reserved-chord guardrails for existing global shortcuts.
- Implement first command set:
  - `pane.split.right`, `pane.split.down`, `pane.close`
  - `pane.focus.{left,right,up,down,next,last}`
  - `pane.zoom.toggle`
  - `keyboard.help.open`, `keyboard.palette.open`, `keyboard.mode.cancel`
  - `workspace.coordinator.open`, `workspace.stream.cancel`

## Phase 2: Practical tmux Coverage

- Add window commands:
  - `window.create`, `window.close`, `window.rename`
  - `window.next`, `window.prev`, `window.last`, `window.select_index`
- Add layout commands:
  - `layout.equalize`, `layout.cycle`
- Add pane resize commands:
  - `pane.resize.{left,right,up,down}` with repeat handling.
- Add pane number mode (`Ctrl+b q`) to focus by number.

## Phase 3: Advanced Pane Ops + UX Completion

- Add advanced pane operations:
  - `pane.swap.prev`, `pane.swap.next`
  - `pane.rotate`
  - `pane.break_to_window`
- Complete discoverability/editing:
  - full shortcuts overlay
  - command palette with command+binding display
  - settings page for rebinding, conflict detection, import/export, reset
- Migrate duplicated ad-hoc listeners (`Ctrl+O`, `Escape`, etc.) to commands.

## Phase 4: Stabilization

- Add tests for parser/matcher, prefix state machine, conflicts, and reducer action semantics.
- Add feature flag for rollout and toggle default-on after validation.
- Update workspace docs to reflect new action semantics and keyboard system.

## Existing Files To Touch

## Workspace Core

- `agent-manager-web/src/workspace/KEYBINDINGS.md`
- `agent-manager-web/src/workspace/README.md`
- `agent-manager-web/src/workspace/store.tsx`
- `agent-manager-web/src/workspace/layout.ts`
- `agent-manager-web/src/workspace/types.ts` (only if action/state typing needs expansion)
- `agent-manager-web/src/workspace/persistence.ts` (workspace persistence stays isolated; keybinding persistence is separate)

## Workspace UI

- `agent-manager-web/src/routes/workspace.tsx`
- `agent-manager-web/src/workspace/ui/workspace-view.tsx`
- `agent-manager-web/src/workspace/ui/workspace-view_layout.tsx`

## Existing Keyboard/Event Call Sites To Migrate or Integrate

- `agent-manager-web/src/routes/root.tsx`
- `agent-manager-web/src/workspace/panels/agent-session.tsx`
- `agent-manager-web/src/workspace/panels/agent-detail.tsx`
- `agent-manager-web/src/components/messages/codex-message.tsx`
- `agent-manager-web/src/components/messages/pi-message.tsx`

## Coordinator Toolchain Files (Trace + Potential Updates)

These are the files involved in what gets exposed to coordinator today, and are touchpoints if we later expose keybinding state/commands.

### Backend

- `agent-manager/src/routes/session.ts`
- `agent-manager/src/routes/agents.ts`
- `agent-manager/src/services/session.service.ts`
- `shared/ui-actions-contract.ts`

### Frontend coordinator runtime + contracts

- `agent-manager-web/src/lib/api.ts`
- `agent-manager-web/src/ui-actions/execute.ts`
- `agent-manager-web/src/ui-actions/context.ts`
- `agent-manager-web/src/ui-actions/types.ts`
- `agent-manager-web/src/coordinator-actions/runtime-bridge.ts`
- `agent-manager-web/src/coordinator-actions/workspace-bridge.tsx`
- `agent-manager-web/src/ui-actions/registry.ts`
- `agent-manager-web/src/ui-actions/actions/navigation.ts`
- `agent-manager-web/src/ui-actions/actions/workspace.ts`
- `agent-manager-web/src/ui-actions/actions/chat.ts`
- `agent-manager-web/src/components/coordinator-session-dialog.tsx`
- `agent-manager-web/src/routes/workspace.tsx`
- `agent-manager-web/src/workspace/ui/workspace-view.tsx`

## Settings Navigation

- `agent-manager-web/src/routes/settings-layout.tsx`
- `agent-manager-web/src/routes/settings-general.tsx` (only if shared settings patterns are reused)

## New Files To Add

## Keybinding Domain

- `agent-manager-web/src/workspace/keybindings/types.ts`
- `agent-manager-web/src/workspace/keybindings/defaults.ts`
- `agent-manager-web/src/workspace/keybindings/commands.ts`
- `agent-manager-web/src/workspace/keybindings/engine.ts`
- `agent-manager-web/src/workspace/keybindings/conflicts.ts`
- `agent-manager-web/src/workspace/keybindings/persistence.ts`
- `agent-manager-web/src/workspace/keybindings/use-workspace-keybindings.ts`

## Workspace UI Surfaces

- `agent-manager-web/src/workspace/ui/workspace-hotkeys-layer.tsx`
- `agent-manager-web/src/workspace/ui/workspace-keybindings-dialog.tsx`
- `agent-manager-web/src/workspace/ui/workspace-command-palette.tsx`

## Settings Surface

- `agent-manager-web/src/routes/settings-keybindings.tsx`

## Tests

- `agent-manager-web/src/workspace/keybindings/engine.test.ts`
- `agent-manager-web/src/workspace/keybindings/conflicts.test.ts`

## Action Gaps To Implement in Store/Layout

Current reducer already covers split/close/focus/move/basic windows. Additional action coverage needed for tmux parity:

- `pane/focus-next`
- `pane/focus-prev`
- `pane/focus-direction` (left/right/up/down)
- `pane/swap-next`
- `pane/swap-prev`
- `pane/rotate`
- `pane/break-to-window`
- `split/resize-direction`
- `layout/equalize`
- `layout/cycle`
- `window/activate-next`
- `window/activate-prev`
- `window/activate-last`
- `window/activate-index`

## Command Source of Truth

All keyboard dispatch, help UI, and palette UI should consume the same command registry:

- command ID
- title/description/category
- context predicate
- implementation (`run`)
- default bindings

No command should exist only in UI or only in keyboard handlers.

## Coordinator Exposure Plan (Keybindings)

Current state:

- Coordinator can call semantic UI actions and read `ui_get_state`.
- `ui_get_state` currently excludes keybinding profile/binding data.

If we want coordinator visibility/editability for keybindings, add in this order:

1. Extend snapshot types and builders:
   - `agent-manager-web/src/ui-actions/types.ts`
   - `agent-manager-web/src/ui-actions/context.ts`.
2. Add semantic action IDs + contract updates:
   - `shared/ui-actions-contract.ts`
   - `agent-manager-web/src/ui-actions/registry.ts`
   - `agent-manager-web/src/ui-actions/actions/*.ts`.
3. Expose runtime bridge/controller surface needed for keybinding read/write:
   - `agent-manager-web/src/coordinator-actions/runtime-bridge.ts`
   - keybinding host layer under `agent-manager-web/src/workspace/keybindings/*`.
4. Keep client-tool contract alignment checks intact:
   - `shared/ui-actions-contract.ts`
   - `agent-manager-web/src/ui-actions/execute.ts`.

## Safety and Behavior Constraints

- Ignore shortcuts in editable fields by default (`input`, `textarea`, `contenteditable`).
- Reserve OS/browser chords (`Cmd/Ctrl+W`, `Cmd/Ctrl+L`, `Cmd/Ctrl+R`, `Cmd/Ctrl+T`, `Cmd/Ctrl+Tab`).
- Prefix timeout should be short and explicit in HUD.
- Unknown prefix chords should display lightweight feedback.
- Terminal-focused behavior should prefer terminal key handling unless explicitly configured.
