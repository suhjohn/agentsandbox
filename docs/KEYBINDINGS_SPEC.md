# Unified UI Actions + Keybindings Spec

This spec describes a unified action system that:

1) Defines a single canonical **UI Actions** layer encompassing *everything the UI can do* (workspace + dialog + chat + navigation + settings flows).
2) Lets humans consume those actions through **tmux-style keybindings** and a **command palette**.
3) Lets the **Coordinator** consume the *exact same* action surface through `ui_list_available_actions` + `ui_run_action`.
4) Enforces a shared, versioned contract in `shared/` that both frontend and backend can import.
5) Treats actions that “don’t apply right now” as **unavailable** (not no-op, not “try and toast”).

This is intentionally written as a system design + contract spec, not an implementation diff.

---

## End-State Compatibility Requirements (Non-Negotiable)

The refactor to a unified UI Actions layer must be an **internal architecture change**. The user-facing behavior should remain the same unless explicitly called out.

- **Command palette UX stays the same**
  - Same look/feel, search behavior, sorting, and “select runs command + closes palette” flow as today.
  - Actions shown in the palette remain the current workspace-facing “tmux-style” subset, even though the underlying action surface is unified and parameterized.
- **Keybindings persistence stays the same**
  - User overrides continue to be saved to the backend via `PATCH /users/me` (`workspaceKeybindings`) and hydrated from `/users/me`.
  - Local persistence remains a cache/fallback (current behavior).
- **Leader/prefix behavior stays the same**
  - The default leader chord should remain whatever the product currently ships with.
  - Users can customize the leader chord in keybinding settings; reset returns to default.
  - Note: in this repository today the default leader chord is `Ctrl+B` (`agent-manager-web/src/workspace/keybindings/defaults.ts` `DEFAULT_LEADER_CHORD`). If the intended shipping behavior is `Option/Alt+B`, that should be changed explicitly and reflected in docs.
- **Reserved global chords stay reserved**
  - Global coordinator shortcuts (and other reserved chords) must remain non-overridable by workspace keymaps.

## Background / Current State

Today there is one canonical action system with two projections:

- **Canonical UI actions**
  - Shared action descriptor contract: `shared/ui-actions-contract.ts`
  - Frontend executable registry: `agent-manager-web/src/ui-actions/registry.ts`
  - Frontend executor: `agent-manager-web/src/ui-actions/execute.ts`
- **Workspace keybindings + palette projection**
  - Workspace-facing metadata projection: `agent-manager-web/src/workspace/keybindings/commands.ts`
  - Keyboard capture + overlay UI: `agent-manager-web/src/workspace/ui/workspace-hotkeys-layer.tsx`
  - Palette UI: `agent-manager-web/src/workspace/ui/workspace-command-palette.tsx`
- **Coordinator adapter**
  - Coordinator-visible actions are filtered from `shared/ui-actions-contract.ts` via the `surfaces.coordinator` flag
  - Frontend execution uses `agent-manager-web/src/ui-actions/execute.ts`

The key requirement is that keyboard, palette, and coordinator all resolve to the same canonical action definitions.

---

## Goals

- **Single action surface**: one canonical list of UI actions for the whole app.
- **Parameterization**: actions accept structured params (with JSON schema) and return structured results.
- **Tmux-style consumption**:
  - Keybindings remain tmux-like (leader/prefix, repeatable actions, etc.).
  - Command palette stays “direct” (search + run), not a heavy multi-form UI by default.
- **Coordinator parity**: Coordinator sees the same action IDs that appear in the command palette.
- **Hard availability contract**: if an action can’t apply given current UI state, it must be `unavailable`.
- **Shared contract in `shared/`**: both `agent-manager` (backend coordinator) and `agent-manager-web` (frontend) import the same list of action IDs + versions.

## Non-goals

- Recreating tmux server/client semantics (detach/attach, multi-client sync, etc.).
- Giving the Coordinator access to raw browser automation as a primary strategy (that remains a fallback).
- Making every action runnable without parameters (some actions inherently require params; the palette can prompt).

---

## Terminology

- **UI Action**: a versioned, parameterized operation representing a UI capability.
- **Invocation**: a UI Action + concrete params (possibly empty) that is executed.
- **Availability**: whether an action is runnable *right now* based on the current UI snapshot.
- **Keybinding context**: keyboard routing state (global/workspace/prefix/etc.). This is **not** availability.

---

## Core Principle: Availability != Keybinding Context

We keep two separate concepts:

1) **Keybinding contexts** decide when a *chord* triggers an invocation (ex: only in prefix mode).
2) **Availability** decides whether an invocation can succeed given UI state (route, auth, focus, etc.).

Coordinator parity depends on (2): Coordinator does not participate in prefix mode, but can run any available action via tools.

---

## UI Actions Model

### Action Descriptor (canonical contract)

Each UI action is a stable ID + version with:

- `id: string` (stable)
- `version: number` (bump on breaking change)
- `title: string` (palette label)
- `description: string`
- `category: string` (palette grouping/search keywords)
- `paramsJsonSchema: JSONSchema` (used by `ui_list_available_actions`)

This descriptor lives in `shared/ui-actions-contract.ts` for contract stability and prompt guidance. Coordinator-visible actions are filtered from that source via `surfaces.coordinator`.

Proposed shape (illustrative):

```ts
export type UiActionDescriptor = {
  readonly id: string
  readonly version: number
  readonly title: string
  readonly description: string
  readonly category: string
  readonly paramsJsonSchema: unknown
}
```

### Action Definition (frontend implementation)

Frontend binds the descriptor to runtime behavior:

- `canRun(snapshot) -> { ok: true } | { ok: false, reason, details? }`
- `run(ctx, params) -> result`

`canRun` must be deterministic based on snapshot.

Proposed shape (illustrative):

```ts
export type UiActionAvailability =
  | { readonly ok: true }
  | {
      readonly ok: false
      readonly reason:
        | "NOT_AUTHENTICATED"
        | "WRONG_ROUTE"
        | "UI_NOT_READY"
        | "DIALOG_CLOSED"
        | "STREAM_IN_PROGRESS"
        | "MUTATION_IN_PROGRESS"
        | "MISSING_REQUIRED_ENTITY"
      readonly details?: string
    }

export type UiActionDefinition<Params, Result> = UiActionDescriptor & {
  readonly paramsSchema: unknown // zod schema in implementation
  readonly canRun: (snapshot: unknown) => UiActionAvailability
  readonly run: (ctx: unknown, params: Params) => Promise<Result> | Result
  readonly surfaces?: {
    readonly palette?: boolean
    readonly keybinding?: boolean
    readonly coordinator?: boolean
  }
}
```

### Versioning Rules

- If the action’s params schema changes in a breaking way, bump `version`.
- If result shape changes in a breaking way, bump `version`.
- If an action ID is renamed/removed, treat it as a breaking change and update contract + docs together.

---

## UI Snapshot (source of truth for availability)

Availability is computed from a single snapshot (same concept as `ui_get_state` today).

Minimum required fields (illustrative; keep aligned with actual snapshot shape):

- Auth:
  - `isAuthenticated: boolean`
- Route / visibility:
  - `routePath: string`
- Workspace:
  - `workspaceReady: boolean`
  - `workspaceFocusedLeafId: string | null`
  - `workspacePanelTypes: string[]`
  - `workspaceSessionsPanelOpen: boolean`
  - `workspaceSessionsPanelGroupBy: string`
  - `workspaceSessionsPanelHasActiveFilters: boolean`
- Dialog/chat:
  - `chatDialogOpen: boolean`
  - `chatStreaming: boolean`
  - `chatHasConversation: boolean`
- Settings context (example):
  - `activeImageId: string | null`
  - `hasDirtyImageDraft: boolean`

Actions should not “probe the DOM” to decide availability; they should use snapshot + runtime controllers.

---

## Availability Contract

### Hard rule

If an action “doesn’t apply right now”, it must be **unavailable**.

Examples:

- `workspace.pane.close` is unavailable when:
  - not authenticated
  - not on workspace route
  - workspace not ready
  - no focused pane
- `chat.send_message` is unavailable when:
  - dialog is closed
  - not authenticated
  - a stream is in progress (if we disallow concurrent sends)

### Standard reason codes

Use a shared set of reason codes so Coordinator + palette can interpret uniformly, e.g.:

- `NOT_AUTHENTICATED`
- `WRONG_ROUTE`
- `UI_NOT_READY`
- `DIALOG_CLOSED`
- `STREAM_IN_PROGRESS`
- `MUTATION_IN_PROGRESS`
- `MISSING_REQUIRED_ENTITY`

`details` should be short, user-readable, and safe to display in a tooltip/toast.

---

## Surfaces

### 1) Command Palette

The command palette is a UI for selecting and running actions.

Requirements:

- Lists the canonical action catalog filtered to `surfaces.palette`.
- Shows disabled actions when `canRun` is false (optional tooltip with `details`).
- If an action has required params:
  - Palette provides a minimal “tmux-like prompt” flow:
    - either a tiny parameter prompt UI (form generated from schema)
    - or a structured text prompt (like `: command key=value ...`) that parses into params

Key point: the palette is allowed to be “tmux-like” (minimal chrome), but still supports structured params when needed.

### 2) Keybindings (tmux-style)

Keybindings remain a mapping from key sequences → invocations (`actionId` + optional `params`).

Keybinding contexts (`global`, `workspace`, `workspace.prefix`, etc.) remain as keyboard routing state.

Rules:

- A keybinding can only trigger an invocation if:
  1) the chord matches in the current keybinding context, and
  2) the invocation’s action is available (`canRun` ok)
- If (2) fails, we should show a lightweight message (toast) with the availability `details`.

### 3) Coordinator

Coordinator consumes the same canonical action catalog via client UI tools:

- `ui_list_available_actions` must list:
  - the unified actions (id/version/description/params schema)
  - whether each is currently available, with reason/details
- `ui_run_action` must:
  - validate `params` against the JSON schema
  - enforce availability (`ACTION_UNAVAILABLE` if `canRun` is false)
  - run the action and return a structured result envelope

Coordinator should not rely on keyboard contexts; it should run invocations directly.

---

## Shared Contract Placement

The shared contract remains in `shared/` and is imported by both:

- backend coordinator prompt + validation (agent-manager)
- frontend UI command registry + validation (agent-manager-web)

This implies a shared “UI Action IDs + versions” list lives in `shared/ui-actions-contract.ts`, with coordinator visibility derived from `surfaces.coordinator`.

Contract enforcement:

- Frontend asserts its implemented command IDs match the shared contract at build/runtime.
- Backend sources its prompt guidance from the same shared contract (no duplicated hard-coded list).

---

## Current Architecture

The current implementation already uses the unified model:

1) `shared/ui-actions-contract.ts` is the canonical descriptor contract.
2) `agent-manager-web/src/ui-actions/registry.ts` owns executable frontend action definitions.
3) `agent-manager-web/src/workspace/keybindings/commands.ts` is a derived workspace projection for help/settings/editor surfaces.
4) `agent-manager-web/src/workspace/keybindings/types.ts` stores bindings as `actionId` + `params`.
5) `agent-manager-web/src/workspace/ui/workspace-hotkeys-layer.tsx` executes canonical actions through `executeUiAction(...)`.
6) `agent-manager-web/src/coordinator-actions/registry.ts` and `executor.ts` are thin adapters over canonical actions filtered to `surfaces.coordinator`.

---

## Open Questions / Decisions (explicit)

- **Palette params UX**: generated form vs tmux-like `:` prompt parsing vs both.
- **Action discoverability**: do we list truly everything by default, or require `surfaces.palette = true`?
- **Result shapes**: do we standardize a small set of result envelopes (ex: `{ performed: true, ... }`)?

---

## Appendix: Why “unavailable” is the right default

When commands are unavailable rather than no-op:

- Coordinator planning becomes reliable (no wasted calls).
- The palette becomes self-documenting (disabled states teach constraints).
- Keybindings feel “stable” (no silent failures; clear reason).
