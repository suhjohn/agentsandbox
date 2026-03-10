# Workspace tmux-Style Keybindings (Spec)

This spec defines a tmux-inspired keybinding system for the workspace UI, centered on a leader key (`Ctrl+b`) and a command registry. It is designed to be:

- **Fast** for power users (prefix chords, repeatable nav/resize).
- **Safe** for web apps (doesn’t hijack browser/OS shortcuts by default).
- **Discoverable** (help overlay + command palette).
- **Configurable** (edit bindings, detect conflicts, import/export).

## Goals

- Support a `Ctrl+b` **leader/prefix** that unlocks tmux-like pane/window workflows.
- Support “all practical” tmux-like operations that map to the workspace model (panes, windows, layouts), plus a few workspace-native commands (sessions side panel, coordinator).
- Make all commands **viewable** (searchable list) and **modifiable** (rebinding UI, persistence).
- Keep the UI “calm and focused” (minimal chrome; transient HUDs; no jarring focus steals).

## Non-goals

- Emulating tmux server/client semantics (detach/attach, multi-client sync, kill-server).
- Full tmux copy-mode parity in v1 (browser selection/scroll already exists; we can add a minimal “scroll mode” later).

## Terms

- **Command**: A named action with an ID (ex: `pane.split.right`) and an implementation (`run(ctx)`).
- **Keybinding**: A mapping from a key sequence to a command (with optional args) within a **context**.
- **Leader / Prefix**: The initial chord `Ctrl+b` that enters a short-lived “prefix mode”.
- **Context**: Where a binding is active (global, workspace-only, focused panel type, etc).

## UX + Safety Rules

1. **Do not capture keys inside inputs by default** (input/textarea/contenteditable), except for explicitly “safe” keys like `Escape`, the leader chord (`Ctrl+b`), and the command-palette chord (`Cmd/Ctrl+k`).
2. **Do not steal browser/OS chords** (ex: `Ctrl/Cmd+W`, `Ctrl/Cmd+L`, `Ctrl/Cmd+R`, `Ctrl/Cmd+T`, `Ctrl/Cmd+Tab`).
3. **Terminal panel is special**: default behavior should prioritize the terminal’s own key handling (nested tmux), while still allowing workspace commands via leader when focus is on pane chrome (or an optional setting to capture inside terminal).
4. **Prefix mode has a timeout** (default ~1s) and shows a subtle HUD: `tmux: (waiting…)` + optional hints.
5. Unknown prefix sequences should show a lightweight toast: `Unbound: Ctrl+b <key>`.

## Existing Global Shortcut Compatibility (Non-Negotiable)

These app-wide shortcuts remain unchanged and take precedence over workspace keymaps:

- `Option/Alt+Space` → toggle coordinator dialog.
- `Option/Alt+Shift+Space` → start a new coordinator chat (draft new session).
- `Option/Alt+Shift+L` → open coordinator sessions list.
- `Cmd/Ctrl+.` (keydown/keyup) → push-to-talk start/stop.
- `Cmd/Ctrl+ArrowUp` / `Cmd/Ctrl+ArrowDown` (while recording) → cycle microphone.

Current implementation lives in `agent-manager-web/src/routes/root.tsx`.

Rules for this spec:

1. Workspace keybinding logic must not shadow these chords.
2. These chords are reserved by default in the keybinding editor.
3. `Ctrl+b` leader support is additive and must not alter current global behavior.

## Keybinding Model

### Key sequence representation

Represent keys using **physical codes** (`KeyboardEvent.code`) for matching, plus a display string for the UI:

- Match on: `{ ctrl, meta, alt, shift, code }`
- Display as: `Ctrl+b`, `Alt+1`, `Up`, `"` / `%` (best-effort based on layout)

### Key tables (contexts)

We emulate tmux “tables” as contexts:

- `global` – available anywhere in the app
- `workspace` – only on the workspace route
- `workspace.prefix` – active only while prefix mode is armed
- `workspace.pane_number` – active only while “display panes” chooser is open
- `panel:<panelType>` – when a specific panel type is focused (optional)

## Default Leader

- **Leader**: `Ctrl+b`
- **Send leader**: `Ctrl+b Ctrl+b` (only relevant when a focused panel can accept raw input; for xterm we may leave this to the terminal by default)

## Command Palette + Keybindings UI

- `Ctrl+b :` opens the **command palette** (tmux command-prompt equivalent).
- `Ctrl+b ?` opens the **Keybindings** overlay (searchable; shows effective bindings).

Both UIs use the **same command registry** so the palette, help overlay, and keybinding editor never drift.

---

# Commands (User-Facing Spec)

Notation: `Prefix` means `Ctrl+b` followed by the next key.

## Help / Meta

| Keys | Command ID | What It Does |
|---|---|---|
| `Prefix ?` | `keyboard.help.open` | Opens a searchable “Keyboard Shortcuts” overlay. |
| `Prefix :` / `Prefix Cmd+k` / `Prefix Ctrl+k` | `keyboard.palette.open` | Opens the command palette (type to search commands). |
| `Prefix Ctrl+b` | `keyboard.leader.send` | Sends a literal `Ctrl+b` to the focused panel when applicable (terminal nested tmux support depends on panel integration). |
| `Escape` | `keyboard.mode.cancel` | Cancels prefix/chooser modes and closes lightweight overlays. |

## Panes (Workspace leaves)

| Keys | Command ID | What It Does |
|---|---|---|
| `Prefix "` | `pane.split.down` | Splits the focused pane into **top/bottom** (new pane below). |
| `Prefix %` | `pane.split.right` | Splits the focused pane into **left/right** (new pane to the right). |
| `Prefix _` | `pane.split.down.full` | Splits the **full window** into top/bottom regions (new region below). |
| `Prefix \|` | `pane.split.right.full` | Splits the **full window** into left/right regions (new region on the right). |
| `Prefix x` | `pane.close` | Closes the focused pane (confirm if destructive). |
| `Prefix z` | `pane.zoom.toggle` | Toggles expand (fullscreen dialog for focused pane). |
| `Prefix o` | `pane.focus.next` | Focuses the next pane (cycle). |
| `Prefix ;` | `pane.focus.last` | Focuses the previously focused pane. |
| `Prefix Left` / `Prefix h` | `pane.focus.left` | Focuses the adjacent pane to the left (if any). |
| `Prefix Right` / `Prefix l` | `pane.focus.right` | Focuses the adjacent pane to the right (if any). |
| `Prefix Up` / `Prefix k` | `pane.focus.up` | Focuses the adjacent pane above (if any). |
| `Prefix Down` / `Prefix j` | `pane.focus.down` | Focuses the adjacent pane below (if any). |
| `Prefix q` | `pane.number_mode.open` | Shows pane numbers overlay; next digit focuses that pane. |
| `Prefix {` | `pane.swap.prev` | Swaps focused pane with previous pane in traversal order. |
| `Prefix }` | `pane.swap.next` | Swaps focused pane with next pane in traversal order. |
| `Prefix Ctrl+o` | `pane.rotate` | Rotates panes (moves panels through panes in traversal order). |
| `Prefix !` | `pane.break_to_window` | Moves the focused pane into a new workspace window. |

### Pane resizing (repeatable)

| Keys | Command ID | What It Does |
|---|---|---|
| `Prefix Ctrl+Left` | `pane.resize.left` | Shrinks/expands focused pane toward left (step). |
| `Prefix Ctrl+Right` | `pane.resize.right` | Shrinks/expands toward right (step). |
| `Prefix Ctrl+Up` | `pane.resize.up` | Shrinks/expands toward up (step). |
| `Prefix Ctrl+Down` | `pane.resize.down` | Shrinks/expands toward down (step). |

Notes:

- These commands should be **repeatable** while holding the arrow key (respect `e.repeat`).
- Step default: ~0.02 ratio (configurable).

## Windows (Workspace windows)

| Keys | Command ID | What It Does |
|---|---|---|
| `Prefix c` | `window.create` | Creates a new workspace window and switches to it. |
| `Prefix &` | `window.close` | Closes the current window (confirm; must keep at least one). |
| `Prefix ,` | `window.rename` | Renames the current window (inline prompt). |
| `Prefix n` | `window.next` | Switches to next window (stable ordering). |
| `Prefix p` | `window.prev` | Switches to previous window (stable ordering). |
| `Prefix l` | `window.last` | Switches to last active window. |
| `Prefix w` | `window.switcher.open` | Opens a window switcher (palette-like list). |
| `Prefix 0..9` | `window.select_index` | Switches to a window by index (requires stable indexing). |

## Layouts (Practical subset)

| Keys | Command ID | What It Does |
|---|---|---|
| `Prefix Space` | `layout.cycle` | Cycles through practical layout transforms (see below). |
| `Prefix =` | `layout.equalize` | Rebalances split ratios by descendant pane counts (equalizes sizes without changing structure). |

`layout.cycle` proposed cycle (configurable):

1. `layout.equalize`
2. `layout.flatten.rows` (optional; convert to one row of panes)
3. `layout.flatten.cols` (optional; convert to one column of panes)
4. `layout.tile` (optional; balanced tiling)

The optional transforms are “nice-to-have” and can be added incrementally.

## Workspace-native (not tmux, but practical)

| Keys | Command ID | What It Does |
|---|---|---|
| `Prefix s` | `workspace.sessions_panel.toggle` | Toggles the left Sessions side panel open/closed. |
| `Prefix f` | `workspace.sessions_panel.focus_filter` | Focuses the Sessions filter UI (search input) when open. |
| `Prefix e` | `workspace.coordinator.open` | Opens the coordinator dialog (alias for existing UI). |
| `Prefix Escape` | `workspace.stream.cancel` | Cancels an active stream/run in the focused panel (when supported). |

---

# “Commands” are the Source of Truth

Every keybinding maps to a command ID. Commands must be:

- **Listable** (title + description + category + context)
- **Runnable** (from keyboard or command palette)
- **Bindable** (0..N bindings per command)

Example command schema:

```ts
type Command = {
  readonly id: string
  readonly title: string
  readonly category: 'Panes' | 'Windows' | 'Layout' | 'Workspace' | 'Keyboard'
  readonly when: 'global' | 'workspace' | `panel:${string}`
  readonly run: (ctx: CommandContext, args?: unknown) => void | Promise<void>
}
```

---

# One-Level Implementation Approach

1. **Add a command registry** (single source of truth)
   - Exports all commands + metadata.
   - Uses existing store actions where possible (ex: `leaf/split`, `leaf/close`, `leaf/focus`, `window/create`, etc.).
   - Adds a small number of new store actions/utilities for missing tmux primitives (`pane.swap.*`, `pane.rotate`, `pane.break_to_window`, `pane.resize.*`).

2. **Add a keybinding engine with prefix modes**
   - Captures `keydown` (capture phase) at the app root.
   - Tracks a tiny state machine: `idle` → `prefix(armed)` → `execute` → `idle`.
   - Supports a “pane number mode” and other transient modes as separate tables.
   - Applies gating rules (ignore inside inputs unless configured).

3. **Hook it into the app**
   - Global commands (coordinator toggle/PTT) stay in `routes/root.tsx`.
   - Workspace commands mount inside `WorkspaceProvider` scope so they can dispatch workspace actions (`workspace/ui/workspace-view.tsx` is a good mount point).

4. **Build the UI for viewing + editing**
   - `Prefix ?` opens Keybindings overlay: shows effective bindings, search, “Record new binding”, conflicts, reset.
   - `Prefix :` (and `Mod+K`) opens command palette: lists same commands; shows bindings next to them.
   - Persist user overrides to localStorage (and optionally to backend later).

5. **Migrate ad-hoc keyboard handlers**
   - Replace scattered `keydown` listeners (`Ctrl+O`, `Escape`, etc.) with commands so behavior is consistent and configurable.

---

# Coordinator Tool Exposure (Current State)

## Client tool contract and entry points

- Tool names are contract-backed in `shared/coordinator-client-tools-contract.ts`:
  - semantic: `ui_get_state`, `ui_list_available_actions`, `ui_run_action`
  - browser fallback: `ui_browser_*`
- Backend coordinator exposes those tools in `agent-manager/src/coordinator/index.ts` (`createClientUiTools`).
- Frontend executes the same tool set in `agent-manager-web/src/coordinator-actions/executor.ts`.
- Backend and frontend both assert contract alignment with the shared contract file.

## End-to-end request path (backend to frontend)

1. Frontend starts run with browser tools enabled:
   - `agent-manager-web/src/lib/api.ts` (`startCoordinatorRun`, `browserAvailable`)
   - called from `agent-manager-web/src/routes/chat-conversation.tsx`.
2. Backend receives run create and stores `browserAvailable`:
   - `agent-manager/src/routes/coordinator.ts`
   - `agent-manager/src/services/agent-run-manager.ts`.
3. During stream, backend emits `client_tool_request` events and waits for result:
   - `agent-manager/src/services/agent-run-manager.ts`.
4. Frontend stream handler receives request, executes, and submits result:
   - `agent-manager-web/src/routes/chat-conversation.tsx`
   - `agent-manager-web/src/coordinator-actions/executor.ts`
   - `agent-manager-web/src/lib/api.ts` (`submitCoordinatorToolResult`).
5. Backend accepts tool result at:
   - `agent-manager/src/routes/coordinator.ts` (`/coordinator/runs/:runId/tool-result`).

## What coordinator can currently “see”

- Semantic action contract: `shared/coordinator-actions-contract.ts`.
- Action registry and implementations:
  - `agent-manager-web/src/coordinator-actions/registry.ts`
  - `agent-manager-web/src/coordinator-actions/actions/*.ts`.
- Runtime state exposed by `ui_get_state`:
  - `agent-manager-web/src/coordinator-actions/types.ts`
  - `agent-manager-web/src/coordinator-actions/context.ts`
  - `agent-manager-web/src/coordinator-actions/runtime-bridge.ts`
  - `agent-manager-web/src/coordinator-actions/workspace-bridge.tsx`
  - `agent-manager-web/src/routes/workspace.tsx`
  - `agent-manager-web/src/components/coordinator-session-dialog.tsx`
  - `agent-manager-web/src/workspace/ui/workspace-view.tsx`.

Current `ui_get_state` includes workspace/chat/dialog/session-panel semantic state, but does **not** include keybinding profile or binding definitions. If we want coordinator to inspect/modify keybindings, we must add explicit snapshot fields and semantic actions.

# Persistence + Modifiability

## Storage

- Store defaults in code.
- Persist user overrides in the user profile via existing `PATCH /users/me` settings API (`workspaceKeybindings` JSONB column in `users`); save `null` when there are no overrides.
- Keep localStorage as a fast cache/fallback only.
- Persist:
  - leader key
  - per-command bindings
  - per-context overrides
  - optional profile metadata (`tmux`, `vscode`, etc.)

## Editor requirements

- Record a new binding (including `Prefix` sequences).
- Show conflicts inline (same sequence in same context).
- Allow multiple bindings per command.
- Export/import JSON.
- Reset to defaults.
