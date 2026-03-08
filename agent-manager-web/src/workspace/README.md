# Workspace Layout and Panels

This document describes how pane and panel behavior flows through the workspace UI and store.

## Key Files

- `agent-manager-web/src/routes/workspace.tsx`
- `agent-manager-web/src/workspace/ui/workspace-view.tsx`
- `agent-manager-web/src/workspace/ui/workspace-view_layout.tsx`
- `agent-manager-web/src/workspace/ui/workspace-hotkeys-layer.tsx`
- `agent-manager-web/src/workspace/ui/workspace-command-palette.tsx`
- `agent-manager-web/src/workspace/ui/workspace-keybindings-dialog.tsx`
- `agent-manager-web/src/workspace/store.tsx`
- `agent-manager-web/src/workspace/layout.ts`
- `agent-manager-web/src/workspace/types.ts`
- `agent-manager-web/src/workspace/keybindings/commands.ts`
- `agent-manager-web/src/workspace/keybindings/defaults.ts`
- `agent-manager-web/src/workspace/keybindings/engine.ts`
- `agent-manager-web/src/workspace/keybindings/use-workspace-keybindings.ts`
- `agent-manager-web/src/workspace/panels/registry.ts`
- `agent-manager-web/src/workspace/panels/types.ts`

## State Model

- The layout is a recursive tree: `LayoutNode = SplitNode | LeafNode` (`types.ts`).
- A `LeafNode` is one pane with exactly one panel:
  - `panelInstanceId`: the panel mounted in that leaf.
- Panel instances are stored in `WindowState.panelsById` and referenced by `panelInstanceId` from leaves.
- Canonical panel types in the registry are:
  - `coordinator`
  - `agent_list`
  - `agent_create`
  - `agent_detail`
  - `empty`

## Top-Down Render Flow

1. `WorkspacePage` wraps `WorkspaceView` with `WorkspaceProvider`.
2. `WorkspaceView` renders:
   - the top bar (`Sandmux` + workspace controls + window chips)
   - `WorkspaceHotkeysLayer` (workspace keybinding engine + overlays)
   - the pane layout (`<LayoutNodeView node={activeWindowRoot} />`)
   - an optional left-side Sessions panel (local UI state in `workspace-view.tsx`)
3. `LayoutNodeView` is recursive:
   - `split` -> `SplitView`
   - `leaf` -> `LeafView`
4. `SplitView` renders child nodes (`a`, `b`) plus an overlay resize handle.
5. `LeafView` renders:
   - pane header (drag handle + panel title)
   - pane header fullscreen button (opens that pane's panel in a dialog)
   - pane controls (panel picker + optional panel header controls)
   - a panel body slot (`data-panel-active`) for that leaf’s `panelInstanceId`
6. A root-level panel portal layer maps current leaf slots and mounts one `PanelHost` per visible `panelInstanceId` into its slot.
7. `PanelHost` resolves the panel instance from `panelsById`, gets its definition from the registry, and mounts the panel component.

## Root Sessions Side Panel (`/`)

- Visibility is local to `WorkspaceView`:
  - Open/closed state is persisted via cookie `agentManagerWeb.workspaceSessionsPanelOpen`.
  - Width is persisted via cookie `agentManagerWeb.workspaceSessionsPanelWidthPx`.
  - A single toggle button next to `Sandmux` opens/closes the panel from top nav.
  - Top bar controls (sessions toggle, window chips, key bindings, coordinator, split/close) show hover tooltips with keyboard shortcuts.
  - The top-bar coordinator button tooltip shows the reserved global shortcut `Option/Alt+Space`.
  - Open: the left-side panel is rendered with an overlay resize handle on its right edge (visual bar appears on hover, no extra layout width).
- Coordinator runtime bridge:
  - `WorkspaceView` registers a sessions-side-panel runtime controller in `coordinator-actions/runtime-bridge.ts`.
  - Semantic actions can open/close the side panel and mutate filter/group-by state without selector clicks.
  - Exposed semantic actions: `workspace.sessions_panel.open`, `workspace.sessions_panel.close`, `workspace.sessions_panel.set_filters`, `workspace.sessions_panel.set_group_by`.
- Panel content:
  - "Create new session" button:
    - opens the coordinator dialog
    - creates a fresh coordinator session via the dialog runtime controller
    - pre-fills the coordinator composer with `can you create a new session for `
    - is always available for authenticated users; it does not depend on image count or the `Image name` filter
  - Session list:
    - `GET /session` for normal list mode.
    - `GET /session/groups` for grouped list mode.
    - When a message is sent from an `agent_detail` session, that session is patched optimistically to `processing` in side-panel caches before stream/server reconciliation.
    - When an `agent_detail` session stream transitions from running to stopped, side-panel session query caches are patched optimistically for that session (`status`, `updatedAt`, `title`, `lastMessageBody`) before server reconciliation.
    - Hovering a session row shows a right-side hover detail card (`image`, `agent`, `session`, `status`, `harness`, `created by`, `updated`); `created by` is resolved via `GET /users` ID->name mapping, and the card stays open while either the row or card is hovered.
  - Session rows show an archive action button on hover; archiving sets `isArchived = true` via `PUT /session/{id}` and refreshes list/group queries.
  - Filter menu fields: `image name` (stored/query-backed by `imageId`), `agentId`, `createdBy`, `archived` (`false` default, `true`, `all`), `status`, `updatedAt` range, `createdAt` range.
  - Group-by menu options: `image name` (`imageId` key with display joined to image names), `createdBy`, `status` (or none).
- Clicking a listed session opens/replaces the focused pane with `agent_detail` in `session_detail` tab for that session (`panel/open` with `placement: "self"`).

## Event -> Action -> State Flow

All UI interactions dispatch actions to `workspace/store.tsx` reducer:

- Focus pane: `leaf/focus`
- Focus next/prev pane in traversal order (wrap): `pane/focus-next`, `pane/focus-prev`
- Focus adjacent pane by placement (`left`/`right`/`up`/`down`): `pane/focus-direction`
- Split pane: `leaf/split`
- Close pane: `leaf/close`
- Move pane (re-dock / center-swap): `pane/move`
- Resize split: `split/ratio`
- Resize focused pane toward a direction: `split/resize-direction`
- Swap/rotate panes in traversal order: `pane/swap-next`, `pane/swap-prev`, `pane/rotate`
- Break focused pane into a new window: `pane/break-to-window`
- Split the full window into a new top/bottom or left/right sibling region: `window/split-full`
- Equalize/cycle layout transforms: `layout/equalize`, `layout/cycle`
- Activate windows by navigation/index/history: `window/activate-next`, `window/activate-prev`, `window/activate-last`, `window/activate-index`
- Change panel type: `panel/type`
- Update panel config: `panel/config`
- Open panel via panel runtime API: `panel/open`

## Keyboard System (tmux-style)

- Workspace keyboard handling is centralized in `WorkspaceHotkeysLayer`, which mounts `useWorkspaceKeybindings` and captures `keydown` at capture phase.
- Leader mode is `Ctrl+b` with a short timeout. Prefix/chooser state comes from `workspace/keybindings/engine.ts`.
- The same command registry drives:
  - keyboard execution (`workspace-hotkeys-layer.tsx`)
  - key bindings list (`workspace-command-palette.tsx`)
  - shortcuts/help overlay (`workspace-keybindings-dialog.tsx`)
  - settings editor (`/settings/keybindings`, `routes/settings-keybindings.tsx`)
- Effective overrides are selected as: non-empty account `workspaceKeybindings` (when present), otherwise localStorage overrides for that user.
- Keybinding overrides are saved to user settings via `PATCH /users/me` (`workspaceKeybindings`) and hydrated from `/users/me`; empty overrides are persisted as `null` (defaults), and localStorage remains a cache/fallback.
- Reserved global chords are not intercepted by workspace keymaps:
  - `Option/Alt+Space` (coordinator dialog)
  - `Option/Alt+Shift+Space` (coordinator new chat)
  - `Option/Alt+Shift+L` (coordinator sessions list)
  - `Cmd/Ctrl+.` (PTT)
- `Escape` cancellation and `Cmd/Ctrl+O` collapsible toggling are routed through workspace commands rather than pane-local `onKeyDown` handlers.
- Pane expand hotkey (`pane.zoom.toggle`) dispatches `agent-manager-web:workspace-pane-zoom-toggle`; `LeafView` listens and toggles fullscreen for the targeted/focused leaf.

## Pane and Panel Details

- Closing the only leaf is not allowed.
- Splitting a leaf clones the current leaf’s panel into a new sibling leaf (new `panelInstanceId`, deep-copied config; no shared pointers). If the source panel cannot be found, the sibling defaults to `coordinator`.
- `window/split-full` keeps the existing layout tree intact as one side of a new root split and inserts a new cloned panel as the opposite full-window side (enables “wide split/stack” layouts).
- Changing panel type (`panel/type`) resets panel config to that panel definition’s default config.
- `panel/config` always runs panel config through that panel definition’s `deserializeConfig`:
  - updater input is normalized config (never raw/undefined)
  - updater output is normalized again before storing
- `panel/open` behavior:
  - `self`: replace current pane’s panel
  - `left` / `right` / `top` / `bottom`: replace adjacent pane if one exists in that direction; otherwise create a new split pane on that edge
  - when `config` is provided, it is normalized via the target panel definition’s `deserializeConfig` before storing
- `agent_detail` remains a container panel with internal tabs in its own config (`session_list`, `session_detail`, `terminal`, `browser`, `diff`).
- In `agent_detail` session detail, the bottom composer bar is owned by `panels/agent-session.tsx` and includes:
  - harness label
  - model combobox
  - thinking-level dropdown persisted in panel config as `sessionModelReasoningEffort`
  - valid thinking options are harness-specific: `codex` -> default or `minimal|low|medium|high|xhigh`; `pi` -> default or `off|minimal|low|medium|high|xhigh`
  - composer create/send/reset calls forward both `model` and `modelReasoningEffort` to the runtime session API
  - empty `Default model` / `Default thinking` selections are forwarded as explicit empty values so the runtime can materialize configured defaults onto the session record instead of silently keeping a previous override
  - session detail scroll snaps to the latest message once when a session first loads in a pane, and a local send also forces one jump to bottom; otherwise it only sticky-scrolls while the user remains near the bottom
- Split resize handles are overlay controls (hover-visible; always visible while dragging) so they do not reserve permanent layout width/height between panes.
- `split/resize-direction` adjusts the nearest eligible ancestor split for the focused leaf (tmux-style directional resize) using a small ratio step.
- `layout/equalize` rebalances every split ratio by descendant leaf counts (without changing pane structure), so skewed split trees can still equalize pane sizes.
- `layout/cycle` performs practical transforms in order: equalize current mixed ratios, then rebuild into all-rows, then all-cols (leaf order preserved).
- `window/activate-last` tracks last active window in workspace state, and window activation by index uses stable `Object.keys(windowsById)` order.
- Focused pane visual treatment is in pane chrome (grab-handle accent + stronger border) instead of a dedicated top-border accent line.
- Pane header background is focus-aware: focused pane headers use a lighter surface, unfocused pane headers remain darker.
- Pane focus (`leaf/focus`) is dispatched from both pane chrome (`LeafView`) and panel body host (`PanelHost`) pointer interactions, so clicking panel content activates focused-pane chrome.
- Pane header includes a fullscreen control that opens the active panel in an edge-to-edge viewport dialog (`inset: 0`, full `dvh`, no inset margins/radius); panel content is moved from the leaf body slot into the dialog slot while open, then returns to the leaf when closed.
- Top bar includes a horizontal window-chip strip (stable index order from `Object.keys(windowsById)`), click-to-activate for each window, an inline close button on each chip (disabled for the last remaining window), and a create-window button.
- `pane/rotate` rotates panel instances across leaves and then re-focuses the leaf that now contains the previously focused panel instance.
- Panel host containers use `overflow-auto` with contained overscroll so each pane/fullscreen panel owns its scrolling behavior without scroll bleed.

## Drag and Drop Semantics

- Drag payload is pane-only:
  - `pane` payload: `windowId`, `fromLeafId`
- Drop targets accept same-window drags only.
- Pane drag source is the left-side grab handle in the pane header.
- Pane drop computes edge placement (`left` / `right` / `top` / `bottom`) or a center placement (`center`).
- Dropping near the center of a target pane highlights the full pane and dispatches `pane/move` with `placement: "center"`, which swaps the dragged pane with the target pane.
- Non-center drops continue to re-dock the dragged pane on the chosen edge via `pane/move`.
- During active workspace drags, pane body mounts a transparent drag-capture layer so drops still work over embedded interactive content.
- Drag state is force-reset on drop/dragend paths.

## Panel Runtime API

`createPanelRuntime` gives panel components two store-backed helpers:

- `replaceSelf(panelType, config?)` -> dispatches `panel/type` and optional `panel/config`.
- `openPanel(panelType, config?, { placement })` -> dispatches `panel/open`.
  - placements supported: `self`, `left`, `right`, `top`, `bottom`

## Performance Notes

- `LayoutNodeView`, `SplitView`, `LeafView`, and `PanelHost` are memoized.
- Panel hosts are rendered through a root portal layer keyed by `panelInstanceId` and mounted into stable per-panel host elements.
- Leaf slot refs only reattach those host elements when tree shape changes, so split/stack operations do not remount panel components when panel IDs/config remain stable.
- During portal reattachment (e.g. split/stack or fullscreen transitions), the workspace snapshots/restores scroll for the deepest element marked `data-workspace-panel-scroller="true"` within a panel host (allows panels with inner scrollers, like `agent_detail`, to preserve scroll position).
- `useWorkspaceSelector` uses `useSyncExternalStore` and `Object.is` snapshot stability to reduce unnecessary rerenders.
- `PanelDefinition` supports view-level layout/focus hints consumed by workspace chrome:
  - `bodyPadding: "default" | "none"` controls panel container padding.
  - `getAutoFocusSelector(config)` enables focused-pane input autofocus without hardcoding panel type IDs in layout code.
  - Pointer-driven pane focus does not trigger selector autofocus (to avoid stealing focus from clicked content); selector autofocus is reserved for non-pointer focus paths.
  - autofocus resolution targets any matching focusable element in the active panel body (including textareas) and waits for disabled states to clear before focusing.

## Maintenance Rule

When changing workspace layout/panel behavior, update this README in the same PR. At minimum, keep the following synchronized:

- action names and reducer behavior in `store.tsx`
- tree/leaf model in `types.ts` and `layout.ts`
- UI interaction wiring in `ui/workspace-view.tsx` and `ui/workspace-view_layout.tsx`
- panel registry/runtime contracts in `panels/registry.ts` and `panels/types.ts`
