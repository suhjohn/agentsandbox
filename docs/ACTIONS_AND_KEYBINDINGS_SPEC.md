# Actions And Keybindings Spec

This document describes how workspace keybindings, canonical UI actions, runtime
controllers, and the workspace reducer fit together in the current codebase.

If behavior changes in any of the files that participate in this flow, update
this document in the same change.

## Purpose

The workspace keyboard system is intentionally split into layers:

- `workspace/keybindings/*` handles keyboard vocabulary, binding resolution,
  mode transitions, persistence, and conflict detection.
- `ui-actions/*` defines the canonical action catalog and the public execution
  contract for commands.
- `frontend-runtime/*` exposes imperative runtime controllers that UI
  actions call into.
- `workspace/store.tsx` owns the real workspace state transitions.
- Some actions are implemented as transient UI effects or DOM events rather than
  reducer state transitions.

The key design rule is:

1. Keybindings do not directly own workspace behavior.
2. The shared UI action contract defines the authoritative action ids and
   public metadata surface.
3. Canonical UI actions in `agent-manager-web` implement that contract.
4. The workspace runtime controller and reducer own the actual workspace state
   mutations.

## High-Level Architecture

```text
shared/ui-actions-contract.ts
  -> declares action ids, surfaces, versions, and param schemas
  -> agent-manager-web ui-actions registry implements those actions
  -> workspace keybindings project keyboard/palette-capable actions

workspace keydown
  -> WorkspaceHotkeysLayer
  -> useWorkspaceKeybindings()
  -> keybinding engine
  -> actionId + params
  -> executeUiAction(...)
  -> ui-actions registry definition
  -> runtime controller
  -> store.dispatch(...) or transient UI / DOM event
  -> reducer or UI listener applies effect
```

## Layer Ownership

### 1. Keybinding model and defaults

Files:

- `agent-manager-web/src/workspace/keybindings/types.ts`
- `agent-manager-web/src/workspace/keybindings/defaults.ts`
- `agent-manager-web/src/workspace/keybindings/conflicts.ts`
- `agent-manager-web/src/workspace/keybindings/persistence.ts`

Responsibilities:

- Define keybinding contexts:
  - `global`
  - `workspace`
  - `workspace.prefix`
  - `workspace.pane_number`
  - `panel:${string}`
- Define binding structure:
  - `id`
  - `context`
  - `sequence`
  - `actionId`
  - `params`
  - `source`
- Define default leader sequence:
  - `Ctrl+B`
- Define default bindings for workspace commands.
- Define reserved global chords that workspace handling must not intercept.
- Load and save user overrides.
- Detect binding conflicts and reserved chord collisions.

Notes:

- The default bindings are workspace-specific configuration.
- They reference canonical action ids, but they do not implement those actions.

### 2. Keybinding command projection

File:

- `agent-manager-web/src/workspace/keybindings/commands.ts`

Responsibilities:

- Builds the set of commands visible to the workspace keyboard system.
- Filters canonical UI actions down to actions that expose keyboard or palette
  surfaces.
- Adds workspace-specific metadata used by the keybinding UI:
  - category
  - contexts
  - repeatability

Important:

- This file is metadata only.
- It does not execute commands.
- The action ids come from the canonical `ui-actions` registry.

### 3. Keybinding engine

Files:

- `agent-manager-web/src/workspace/keybindings/engine.ts`
- `agent-manager-web/src/workspace/keybindings/use-workspace-keybindings.ts`

Responsibilities:

- Run the keybinding state machine.
- Recognize leader entry and prefix mode.
- Recognize pane number mode.
- Match a keyboard event to a resolved binding.
- Respect reserved chords.
- Respect editable inputs unless capture is explicitly allowed.
- Expose a React hook API for:
  - `handleKeyDown`
  - `runAction`
  - `rebindAction`
  - `removeBinding`
  - `resetBindings`
  - `importBindings`
  - `exportBindings`
  - `enterPaneNumberMode`
  - `cancelModes`

Modes:

- `idle`
- `prefix`
- `pane_number`

Prefix flow:

```text
Ctrl+B
  -> engine enters prefix mode
  -> next single chord is matched against context "workspace.prefix"
  -> binding match executes action
  -> unknown chord exits prefix mode and shows "Unbound"
```

Pane number flow:

```text
prefix command for pane-number mode
  -> engine enters pane_number mode
  -> digit focuses pane by traversal index
  -> escape or invalid key cancels mode
```

### 4. Live workspace keyboard host

Files:

- `agent-manager-web/src/workspace/ui/workspace-hotkeys-layer.tsx`
- `agent-manager-web/src/workspace/ui/workspace-keybindings-dialog.tsx`
- `agent-manager-web/src/workspace/ui/workspace-view.tsx`

Responsibilities:

- Mount the live keyboard event listener on `window` in capture phase.
- Wire `useWorkspaceKeybindings(...)` to real workspace state.
- Convert matched keybinding actions into canonical `executeUiAction(...)`
  calls.
- Register the `workspaceKeybindingController`.
- Render transient keyboard UI:
  - help dialog
  - command palette
  - window switcher
  - rename window dialog
  - prefix HUD
  - pane number chooser

Important:

- `WorkspaceHotkeysLayer` is the actual runtime entry point for workspace
  keyboard handling.
- `workspace-view.tsx` embeds this layer and also consumes binding data to show
  shortcuts in the workspace UI.

### 5. Keybinding editor

File:

- `agent-manager-web/src/routes/settings-keybindings.tsx`

Responsibilities:

- Reuse the same hook and command metadata for the settings page.
- Record and validate user bindings.
- Save and export user overrides.
- Run with `workspaceActive: false` because it is editing the system, not
  driving the live workspace.

### 6. Canonical UI action system

Files:

- `shared/ui-actions-contract.ts`
- `agent-manager-web/src/ui-actions/registry.ts`
- `agent-manager-web/src/ui-actions/execute.ts`
- `agent-manager-web/src/ui-actions/context.ts`
- `agent-manager-web/src/ui-actions/actions/workspace-shared.ts`
- `agent-manager-web/src/ui-actions/actions/keyboard-ui.ts`
- `agent-manager-web/src/ui-actions/actions/workspace-layout.ts`
- `agent-manager-web/src/ui-actions/actions/workspace-panels.ts`
- `agent-manager-web/src/ui-actions/actions/workspace-ui.ts`

Responsibilities:

- Define the shared canonical action catalog:
  - `UiActionId`
  - version
  - title
  - description
  - category
  - surfaces
  - params JSON schema
- Define canonical action ids, titles, descriptions, params, surfaces, and run
  logic.
- Validate action id and params before execution.
- Check whether an action can currently run.
- Build execution context from current runtime controllers and snapshots.

This layer is split in two parts:

- `shared/ui-actions-contract.ts`
  - the contract and action catalog
- `agent-manager-web/src/ui-actions/*`
  - the frontend implementation of that contract

The shared contract is the authoritative source of action identity and surface
metadata. The frontend registry is the authoritative source of implementation.

Examples of canonical workspace keyboard actions:

- `keyboard.help.open`
- `keyboard.palette.open`
- `keyboard.mode.cancel`
- `pane.split.right`
- `pane.close`
- `window.create`
- `window.select_index`
- `layout.cycle`
- `workspace.sessions_panel.toggle`

Important:

- `shared/ui-actions-contract.ts` must declare the action before frontend code
  can implement or use it.
- When a keybinding fires, it should resolve to a canonical UI action id.
- Keyboard execution and non-keyboard execution should go through the same
  action definitions when possible.

### 6a. Shared contract relation to workspace keybindings

The key relationship is:

```text
shared/ui-actions-contract.ts
  -> UiActionId union and UI_ACTIONS descriptors
  -> agent-manager-web/src/ui-actions/registry.ts
  -> agent-manager-web/src/workspace/keybindings/commands.ts
  -> agent-manager-web/src/workspace/keybindings/use-workspace-keybindings.ts
```

Specific consequences:

- `WorkspaceCommandId` is an alias of `UiActionId`.
- Workspace keybinding commands are not a separate id system.
- Keyboard and palette visibility come from action `surfaces`.
- The frontend registry asserts implementation parity with the shared contract.
- Workspace command projection only includes actions that both:
  - exist in the canonical action registry
  - are marked for keyboard or palette surfaces

### 7. Runtime bridge

Files:

- `agent-manager-web/src/frontend-runtime/bridge.ts`
- `agent-manager-web/src/frontend-runtime/workspace-bridge.tsx`

Responsibilities:

- Store the current active runtime controllers in a globally reachable bridge.
- Expose those controllers to `buildUiActionExecutionContext(...)`.
- Implement the imperative workspace runtime controller API over the workspace
  store.

Two runtime controller families matter most here:

- `workspaceController`
  - Imperative workspace operations backed by `store.dispatch(...)`.
- `workspaceKeybindingController`
  - Transient keyboard UI operations such as help, palette, pane-number mode,
    window switcher, sessions panel focus, coordinator open, and stream cancel.

### 8. Workspace reducer and layout operations

Files:

- `agent-manager-web/src/workspace/store.tsx`
- `agent-manager-web/src/workspace/layout.ts`
- `agent-manager-web/src/workspace/panels/registry.ts`

Responsibilities:

- Define workspace actions for reducer-backed state changes.
- Execute the actual state transition logic for windows, panes, layout, panel
  type changes, and panel config updates.
- Provide layout algorithms that reducer cases rely on.
- Define the set of available panel types that some actions cycle through or
  open.

This is the real source of truth for workspace state changes.

## Canonical Execution Flow

### A. Key press to reducer-backed workspace state change

Example: `pane.split.right`

```text
keydown
  -> WorkspaceHotkeysLayer keydown listener
  -> useWorkspaceKeybindings.handleKeyDown()
  -> engine matches prefix chord to "pane.split.right"
  -> WorkspaceHotkeysLayer onAction()
  -> executeUiAction({ actionId: "pane.split.right" })
  -> ui-actions/actions/workspace-layout.ts
  -> ctx.workspaceController.splitFocusedPane("row")
  -> frontend-runtime/workspace-bridge.tsx
  -> store.dispatch({ type: "leaf/split", ... })
  -> workspace/store.tsx reducer case "leaf/split"
  -> workspace state updates
  -> React re-renders
```

### B. Key press to transient keyboard UI

Example: `keyboard.help.open`

```text
keydown
  -> WorkspaceHotkeysLayer keydown listener
  -> useWorkspaceKeybindings.handleKeyDown()
  -> engine matches "keyboard.help.open"
  -> executeUiAction({ actionId: "keyboard.help.open" })
  -> ui-actions/actions/keyboard-ui.ts
  -> ctx.workspaceKeybindingController.openHelp()
  -> WorkspaceHotkeysLayer local state setHelpOpen(true)
  -> help dialog opens
```

### C. Key press to DOM event

Example: `workspace.coordinator.open`

```text
keydown
  -> engine matches "workspace.coordinator.open"
  -> executeUiAction(...)
  -> ui-actions/actions/workspace-ui.ts
  -> ctx.workspaceKeybindingController.openCoordinator()
  -> WorkspaceHotkeysLayer dispatches WORKSPACE_OPEN_COORDINATOR_EVENT
  -> downstream listener opens coordinator UI
```

## Visual Relationship Diagram

```text
+--------------------------------------+
| shared/ui-actions-contract.ts        |
| ids, versions, surfaces, schemas     |
+-------------------+------------------+
                    |
                    v
+--------------------------------------+
| ui-actions registry + action modules |
| frontend implementations             |
+-------------------+------------------+
                    |
                    +----------------------------------+
                    |                                  |
                    v                                  v
+------------------------+            +------------------------------+
| workspace/keybindings  |<---------->| useWorkspaceKeybindings()   |
| types/defaults/conflicts|           | resolves bindings + engine  |
| persistence/commands   |            +---------------+--------------+
+-----------+------------+                            |
            |                                         v
            |                          +-------------------------------+
            |                          | WorkspaceHotkeysLayer         |
            |                          | window keydown capture        |
            |                          | help/palette/window UI        |
            |                          +---------------+---------------+
            |                                          |
            |                                          v
            |                          +-------------------------------+
            |                          | executeUiAction(...)          |
            |                          | validate + canRun + dispatch  |
            |                          +---------------+---------------+
            |                                          |
            |                                          v
            |                          +-------------------------------+
            |                          | runtime controllers           |
            +------------------------->| workspace / keyboard bridge   |
                                       +---------------+---------------+
                                                       |
                              +------------------------+------------------------+
                              |                                                 |
                              v                                                 v
               +-------------------------------+               +-------------------------------+
               | transient UI / DOM events     |               | store.dispatch(...)           |
               | help, palette, HUD, dialogs   |               | reducer-backed behavior       |
               +-------------------------------+               +---------------+---------------+
                                                                               |
                                                                               v
                                                                 +-----------------------------+
                                                                 | workspace/store reducer     |
                                                                 | + workspace/layout helpers  |
                                                                 +-----------------------------+

                                      +----------------------+
                                      | settings-keybindings |
                                      | editor / recorder    |
                                      +----------+-----------+
                                                 |
                                                 v
                                  +------------------------------+
                                  | useWorkspaceKeybindings()   |
                                  | non-live editor use         |
                                  +------------------------------+
```

## Where To Change Things

### If you want to add a new keyboard command

Usually update all relevant layers:

1. Add a canonical UI action in `agent-manager-web/src/ui-actions/actions/*`.
2. Add its descriptor to `shared/ui-actions-contract.ts`.
3. Register and implement it in `agent-manager-web/src/ui-actions/registry.ts`
   and the appropriate action module.
4. If it is workspace-keyboard visible, ensure metadata is reflected in:
   - `agent-manager-web/src/workspace/keybindings/commands.ts`
   - `agent-manager-web/src/ui-actions/actions/workspace-shared.ts`
5. Add a default binding in
   `agent-manager-web/src/workspace/keybindings/defaults.ts` if desired.
6. If the action is reducer-backed, implement the runtime controller method in
   `agent-manager-web/src/frontend-runtime/workspace-bridge.tsx`.
7. If needed, add or update reducer cases in
   `agent-manager-web/src/workspace/store.tsx`.
8. Update this document.

### If you want to change what a key does

- Change the binding in `workspace/keybindings/defaults.ts` or user override
  behavior in `workspace/keybindings/persistence.ts`.
- Do not redefine behavior inside `workspace/keybindings/commands.ts`.
- The action behavior should remain in the canonical UI action definition.

### If you want to change actual workspace behavior

- Prefer changing:
  - `ui-actions/actions/*`
  - `frontend-runtime/workspace-bridge.tsx`
  - `workspace/store.tsx`
  - `workspace/layout.ts`
- Do not treat `workspace/keybindings/*` as the place that owns pane/window
  semantics.

## Current Behavioral Split

### Reducer-backed actions

These ultimately become `store.dispatch(...)` and reducer transitions:

- window lifecycle and activation
- pane split/close/focus/swap/rotate
- pane break-to-window
- split ratio and directional resize
- layout equalize and cycle
- panel type changes
- panel config updates
- panel open/move operations

### Keyboard UI controller actions

These are transient UI behaviors local to the workspace keyboard host:

- open keyboard help
- open keyboard palette
- close transient keyboard UI
- open pane number mode
- open window switcher
- open rename dialog
- toggle sessions panel
- focus sessions filter
- toggle collapsibles
- open coordinator
- cancel focused stream

### DOM event-backed actions

Some actions are implemented as dispatched events instead of reducer actions:

- `WORKSPACE_OPEN_COORDINATOR_EVENT`
- `WORKSPACE_CANCEL_STREAM_EVENT`
- `WORKSPACE_PANE_ZOOM_TOGGLE_EVENT`
- `WORKSPACE_TOGGLE_ALL_COLLAPSIBLES_EVENT`

## Important Invariants

- Canonical action ids come from the UI action contract and registry.
- The shared contract declares the allowed ids before frontend implementation.
- Workspace keybinding commands are a projection of that action catalog, not a
  separate behavior system.
- Reducer-backed workspace behavior should flow through the workspace runtime
  controller into `store.dispatch(...)`.
- Keybinding mode handling is isolated inside the keybinding engine.
- User override payloads must sanitize action ids and contexts before use.
- Reserved global chords must never be stolen by the workspace keybinding
  engine.

## Relevant Files

Core keybinding files:

- `agent-manager-web/src/workspace/keybindings/types.ts`
- `agent-manager-web/src/workspace/keybindings/defaults.ts`
- `agent-manager-web/src/workspace/keybindings/commands.ts`
- `agent-manager-web/src/workspace/keybindings/engine.ts`
- `agent-manager-web/src/workspace/keybindings/conflicts.ts`
- `agent-manager-web/src/workspace/keybindings/persistence.ts`
- `agent-manager-web/src/workspace/keybindings/events.ts`
- `agent-manager-web/src/workspace/keybindings/use-workspace-keybindings.ts`

Live workspace consumers:

- `agent-manager-web/src/workspace/ui/workspace-hotkeys-layer.tsx`
- `agent-manager-web/src/workspace/ui/workspace-keybindings-dialog.tsx`
- `agent-manager-web/src/workspace/ui/workspace-view.tsx`

Settings/editor:

- `agent-manager-web/src/routes/settings-keybindings.tsx`

Canonical action system:

- `shared/ui-actions-contract.ts`
- `agent-manager-web/src/ui-actions/registry.ts`
- `agent-manager-web/src/ui-actions/execute.ts`
- `agent-manager-web/src/ui-actions/context.ts`
- `agent-manager-web/src/ui-actions/actions/workspace-shared.ts`
- `agent-manager-web/src/ui-actions/actions/keyboard-ui.ts`
- `agent-manager-web/src/ui-actions/actions/workspace-layout.ts`
- `agent-manager-web/src/ui-actions/actions/workspace-panels.ts`
- `agent-manager-web/src/ui-actions/actions/workspace-ui.ts`

Runtime bridge:

- `agent-manager-web/src/frontend-runtime/bridge.ts`
- `agent-manager-web/src/frontend-runtime/workspace-bridge.tsx`

Workspace state implementation:

- `agent-manager-web/src/workspace/store.tsx`
- `agent-manager-web/src/workspace/layout.ts`
- `agent-manager-web/src/workspace/panels/registry.ts`
