# Unified UI Commands + Keybindings Spec

This spec describes a unified command system that:

1) Defines a single **UI Commands** layer encompassing *everything the UI can do* (workspace + dialog + chat + navigation + settings flows).
2) Lets humans consume those commands through **tmux-style keybindings** and a **command palette**.
3) Lets the **Coordinator** consume the *exact same* command surface through `ui_list_available_actions` + `ui_run_action`.
4) Enforces a shared, versioned contract in `shared/` that both frontend and backend can import.
5) Treats commands that “don’t apply right now” as **unavailable** (not no-op, not “try and toast”).

This is intentionally written as a system design + contract spec, not an implementation diff.

---

## End-State Compatibility Requirements (Non-Negotiable)

The refactor to a unified UI Commands layer must be an **internal architecture change**. The user-facing behavior should remain the same unless explicitly called out.

- **Command palette UX stays the same**
  - Same look/feel, search behavior, sorting, and “select runs command + closes palette” flow as today.
  - Commands shown in the palette remain the “tmux-style” set (human-friendly), even though the underlying command surface is unified and parameterized.
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

Today there are effectively two command systems:

- **Workspace tmux-like keybindings + command palette**
  - Command catalog: `agent-manager-web/src/workspace/keybindings/commands.ts`
  - Execution switch (dispatches store actions, opens UI): `agent-manager-web/src/workspace/ui/workspace-hotkeys-layer.tsx`
  - Palette UI: `agent-manager-web/src/workspace/ui/workspace-command-palette.tsx`
- **Coordinator semantic UI actions**
  - Action registry: `agent-manager-web/src/coordinator-actions/registry.ts`
  - Action executor + tool wiring: `agent-manager-web/src/coordinator-actions/executor.ts`
  - Shared action ID contract: `shared/coordinator-actions-contract.ts`

This split creates drift risk, duplicated metadata, and makes it hard to ensure “Coordinator can do what humans can do”.

---

## Goals

- **Single command surface**: one canonical list of UI commands for the whole app.
- **Parameterization**: commands accept structured params (with JSON schema) and return structured results.
- **Tmux-style consumption**:
  - Keybindings remain tmux-like (leader/prefix, repeatable actions, etc.).
  - Command palette stays “direct” (search + run), not a heavy multi-form UI by default.
- **Coordinator parity**: Coordinator sees the same command IDs that appear in the command palette.
- **Hard availability contract**: if a command can’t apply given current UI state, it must be `unavailable`.
- **Shared contract in `shared/`**: both `agent-manager` (backend coordinator) and `agent-manager-web` (frontend) import the same list of command IDs + versions.

## Non-goals

- Recreating tmux server/client semantics (detach/attach, multi-client sync, etc.).
- Giving the Coordinator access to raw browser automation as a primary strategy (that remains a fallback).
- Making every command runnable without parameters (some commands inherently require params; the palette can prompt).

---

## Terminology

- **UI Command**: a versioned, parameterized operation representing a UI capability.
- **Invocation**: a UI Command + concrete params (possibly empty) that is executed.
- **Availability**: whether a command is runnable *right now* based on the current UI snapshot.
- **Keybinding context**: keyboard routing state (global/workspace/prefix/etc.). This is **not** availability.

---

## Core Principle: Availability != Keybinding Context

We keep two separate concepts:

1) **Keybinding contexts** decide when a *chord* triggers an invocation (ex: only in prefix mode).
2) **Availability** decides whether an invocation can succeed given UI state (route, auth, focus, etc.).

Coordinator parity depends on (2): Coordinator does not participate in prefix mode, but can run any available command via tools.

---

## UI Commands Model

### Command Descriptor (canonical contract)

Each UI command is a stable ID + version with:

- `id: string` (stable)
- `version: number` (bump on breaking change)
- `title: string` (palette label)
- `description: string`
- `category: string` (palette grouping/search keywords)
- `paramsJsonSchema: JSONSchema` (used by `ui_list_available_actions`)

This “descriptor” is what lives in `shared/` for contract stability and prompt guidance.

Proposed shape (illustrative):

```ts
export type UiCommandDescriptor = {
  readonly id: string
  readonly version: number
  readonly title: string
  readonly description: string
  readonly category: string
  readonly paramsJsonSchema: unknown
}
```

### Command Definition (frontend implementation)

Frontend binds the descriptor to runtime behavior:

- `canRun(snapshot) -> { ok: true } | { ok: false, reason, details? }`
- `run(ctx, params) -> result`

`canRun` must be deterministic based on snapshot.

Proposed shape (illustrative):

```ts
export type UiCommandAvailability =
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

export type UiCommandDefinition<Params, Result> = UiCommandDescriptor & {
  readonly paramsSchema: unknown // zod schema in implementation
  readonly canRun: (snapshot: unknown) => UiCommandAvailability
  readonly run: (ctx: unknown, params: Params) => Promise<Result> | Result
  readonly surfaces?: {
    readonly palette?: boolean
    readonly keybinding?: boolean
    readonly coordinator?: boolean
  }
}
```

### Versioning Rules

- If the command’s params schema changes in a breaking way, bump `version`.
- If result shape changes in a breaking way, bump `version`.
- If a command ID is renamed/removed, treat it as a breaking change and update contract + docs together.

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

Commands should not “probe the DOM” to decide availability; they should use snapshot + runtime controllers.

---

## Availability Contract

### Hard rule

If a command “doesn’t apply right now”, it must be **unavailable**.

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

The command palette is a UI for selecting and running commands.

Requirements:

- Lists the unified command catalog (searchable).
- Shows disabled commands when `canRun` is false (optional tooltip with `details`).
- If a command has required params:
  - Palette provides a minimal “tmux-like prompt” flow:
    - either a tiny parameter prompt UI (form generated from schema)
    - or a structured text prompt (like `: command key=value ...`) that parses into params

Key point: the palette is allowed to be “tmux-like” (minimal chrome), but still supports structured params when needed.

### 2) Keybindings (tmux-style)

Keybindings remain a mapping from key sequences → invocations (command + optional params).

Keybinding contexts (`global`, `workspace`, `workspace.prefix`, etc.) remain as keyboard routing state.

Rules:

- A keybinding can only trigger an invocation if:
  1) the chord matches in the current keybinding context, and
  2) the invocation’s command is available (`canRun` ok)
- If (2) fails, we should show a lightweight message (toast) with the availability `details`.

### 3) Coordinator

Coordinator consumes the same command catalog via client UI tools:

- `ui_list_available_actions` must list:
  - the unified commands (id/version/description/params schema)
  - whether each is currently available, with reason/details
- `ui_run_action` must:
  - validate `params` against the JSON schema
  - enforce availability (`ACTION_UNAVAILABLE` if `canRun` is false)
  - run the command and return a structured result envelope

Coordinator should not rely on keyboard contexts; it should run invocations directly.

---

## Shared Contract Placement

The shared contract remains in `shared/` and is imported by both:

- backend coordinator prompt + validation (agent-manager)
- frontend UI command registry + validation (agent-manager-web)

This implies a shared “UI Command IDs + versions” list lives in `shared/` (existing `shared/coordinator-actions-contract.ts` can evolve into a UI command contract, or a new `shared/ui-commands-contract.ts` can be introduced with a controlled migration).

Contract enforcement:

- Frontend asserts its implemented command IDs match the shared contract at build/runtime.
- Backend sources its prompt guidance from the same shared contract (no duplicated hard-coded list).

---

## Mapping Existing Systems Into This Model (migration strategy)

This describes how we would evolve without breaking everything at once:

1) **Define unified command types + shared contract**
   - Keep tool names (`ui_get_state`, `ui_list_available_actions`, `ui_run_action`) stable initially.
2) **Re-home coordinator semantic actions as UI commands**
   - Move/alias `agent-manager-web/src/coordinator-actions/actions/*` into the unified registry.
3) **Lift workspace commands into the same unified registry**
   - Wrap existing `workspace-hotkeys-layer.tsx` `runCommand(...)` switch as the `run(...)` impl for those commands.
   - Add `canRun(...)` checks per command (derived from snapshot + store/controller availability).
4) **Make command palette list the unified registry**
   - Stop maintaining a separate workspace-only catalog.
5) **Make keybindings invoke unified commands**
   - Keep tmux leader engine; change the “what happens on match” path to run a unified invocation.

At the end, “semantic actions” cease to exist as a separate concept: they’re just UI commands, visible in the palette and callable by the coordinator.

---

## Open Questions / Decisions (explicit)

- **Palette params UX**: generated form vs tmux-like `:` prompt parsing vs both.
- **Command discoverability**: do we list truly everything by default, or require `surfaces.palette = true`?
- **Dangerous commands**: do we encode “dangerous” metadata (and require confirmation in palette/coordinator)?
- **Result shapes**: do we standardize a small set of result envelopes (ex: `{ performed: true, ... }`)?

---

## Appendix: Why “unavailable” is the right default

When commands are unavailable rather than no-op:

- Coordinator planning becomes reliable (no wasted calls).
- The palette becomes self-documenting (disabled states teach constraints).
- Keybindings feel “stable” (no silent failures; clear reason).
