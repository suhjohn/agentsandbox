# COORDINATOR_SEMANTIC_ACTIONS

## 1. Scope
This document defines the Semantic Actions layer for coordinator-driven UI execution.

Goals:
1. Replace low-level click guessing with stable, typed action intents.
2. Make action availability dynamic based on current frontend state.
3. Provide deterministic execution contracts and structured error handling.

### 1.1 Canonical Action ID Contract
- Canonical action ID/version source of truth is `shared/ui-actions-contract.ts`.
- Coordinator-visible subset source of truth is `shared/coordinator-actions-contract.ts`.
- Frontend canonical runtime registry is `agent-manager-web/src/ui-actions/registry.ts`.
- Frontend coordinator adapter registry (`agent-manager-web/src/coordinator-actions/registry.ts`) must match the shared coordinator subset exactly.
- Backend planner prompt (`agent-manager/src/coordinator/index.ts`) should render action IDs from this contract, not from a hard-coded list.
- Canonical client-tool name/version source of truth is `shared/coordinator-client-tools-contract.ts` (semantic and fallback transport tools).

## 2. Principles
1. Actions are semantic, not selector-first.
2. Every action has typed params and typed results.
3. Every action must define `canRun` preconditions.
4. `canRun` is evaluated at execution time, not only discovery time.
5. Unavailable actions return explicit machine-readable errors.

## 3. Runtime Contracts

### 3.0 Client Tool Names (Semantic + Fallback)
Current client tools:
- `ui_get_state`
- `ui_list_available_actions`
- `ui_run_action`
- `ui_browser_navigate`
- `ui_browser_snapshot`
- `ui_browser_click`
- `ui_browser_type`
- `ui_browser_wait`
- `ui_browser_scroll`
- `ui_browser_eval`

Policy:
1. Use semantic actions first (`ui_run_action`).
2. Use `ui_browser_*` tools only when semantic actions cannot express the interaction.
3. Backend runtime-host HTTP work remains a server-tool concern: prefer `coordinator_api_request` with absolute runtime URLs plus `X-Agent-Auth`, not browser tools or shell `curl`.

### 3.1 Action Definition
```ts
export type SemanticActionDefinition<TParams, TResult> = {
  readonly id: string;
  readonly version: 1;
  readonly description: string;
  readonly paramsSchema: z.ZodType<TParams>;
  readonly canRun: (ctx: UiContextSnapshot) =>
    | { ok: true }
    | { ok: false; reason: ActionUnavailableReason; details?: string };
  readonly run: (ctx: UiExecutionContext, params: TParams) => Promise<TResult>;
};
```

### 3.2 Action Request Envelope
```ts
export type ClientToolActionRequest = {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly args: unknown;
  readonly timeoutMs: number;
};
```

### 3.3 Action Result Envelope
```ts
export type ClientToolActionResult =
  | {
      readonly toolCallId: string;
      readonly ok: true;
      readonly data: unknown;
      readonly uiStateAfter?: Partial<UiContextSnapshot>;
    }
  | {
      readonly toolCallId: string;
      readonly ok: false;
      readonly error: {
        readonly code: ActionErrorCode;
        readonly message: string;
        readonly retryable: boolean;
        readonly reason?: ActionUnavailableReason;
      };
    };
```

### 3.4 Error Codes
- `ACTION_UNKNOWN`
- `ACTION_INVALID_PARAMS`
- `ACTION_UNAVAILABLE`
- `ACTION_TIMEOUT`
- `ACTION_EXECUTION_FAILED`
- `ACTION_ABORTED`

### 3.5 Unavailable Reasons
- `NOT_AUTHENTICATED`
- `WRONG_ROUTE`
- `DIALOG_CLOSED`
- `STREAM_IN_PROGRESS`
- `MUTATION_IN_PROGRESS`
- `MISSING_REQUIRED_ENTITY`
- `UI_NOT_READY`

## 4. Dynamic Availability Model

### 4.1 Context Snapshot
`canRun` derives from a lightweight frontend snapshot:

```ts
export type UiContextSnapshot = {
  readonly isAuthenticated: boolean;
  readonly routePath: string;
  readonly workspaceReady: boolean;
  readonly workspaceWindowCount: number;
  readonly workspaceLeafCount: number;
  readonly workspaceFocusedLeafId: string | null;
  readonly workspacePanelTypes: readonly string[];
  readonly workspaceSessionsPanelOpen: boolean;
  readonly workspaceSessionsPanelGroupBy: "none" | "imageId" | "createdBy" | "status";
  readonly workspaceSessionsPanelHasActiveFilters: boolean;
  readonly chatDialogOpen: boolean;
  readonly chatStreaming: boolean;
  readonly chatHasConversation: boolean;
  readonly settingsGeneralReady: boolean;
  readonly settingsGeneralDirty: boolean;
  readonly settingsGeneralCanSave: boolean;
  readonly settingsImagesReady: boolean;
  readonly settingsImagesCount: number;
  readonly settingsImageDetailReady: boolean;
  readonly settingsImageLoaded: boolean;
  readonly settingsImageCanEdit: boolean;
  readonly settingsImageArchived: boolean;
  readonly settingsImageBuildRunning: boolean;
  readonly activeImageId: string | null;
  readonly hasDirtyImageDraft: boolean;
  readonly isBusy: boolean;
};
```

### 4.2 Discovery API (recommended)
Use one semantic action discovery call:

```ts
list_available_actions() => {
  actions: Array<{
    id: string;
    version: 1;
    available: boolean;
    reason?: ActionUnavailableReason;
    description: string;
    paramsJsonSchema: object;
  }>;
}
```

Notes:
1. Discovery is advisory only.
2. Executor still re-checks `canRun` at runtime.

### 4.3 Actual Client Tool Flow
For `ui_get_state`, `ui_list_available_actions`, and `ui_run_action`, the canonical execution path is the live frontend client-tool loop, not sandbox Python helpers.

`ui_list_available_actions` flow:
1. The coordinator backend registers `ui_list_available_actions` in `agent-manager/src/coordinator/index.ts`.
2. When the model calls that tool, backend execution delegates to `clientTools.requestClientTool(...)` instead of computing the result locally.
3. The run manager emits a `client_tool_request` event into the active run stream with `runId`, `toolCallId`, `toolName`, `args`, and `timeoutMs`.
4. The live frontend receives that event in `agent-manager-web/src/routes/chat-conversation.tsx`.
5. The frontend calls `executeCoordinatorClientToolRequest(...)` from `agent-manager-web/src/coordinator-actions/executor.ts`.
6. For `ui_list_available_actions`, the executor builds the current frontend UI execution context and calls `listAvailableUiActionsForContext(...)` from `agent-manager-web/src/ui-actions/execute.ts`.
7. `listAvailableUiActionsForContext(...)` evaluates registered frontend UI actions for the `coordinator` surface and computes `available`/`reason` from the current frontend snapshot.
8. The frontend submits the structured result back to `POST /coordinator/runs/:runId/tool-result`.
9. The backend resolves the pending client-tool request and returns that result to the coordinator run.

Important implications:
1. The value is derived from live frontend state, not from backend-only state.
2. Canonical action IDs/versions still come from `shared/ui-actions-contract.ts`.
3. Files under `agent-manager/seeds/coordinator/tools/ui-actions/*` are not the canonical implementation of these client tools.

## 5. V1 Action Catalog

## 5.1 Global and Navigation

### `nav.go`
Description: Navigate to a route alias or an absolute app route path.

Params:
```json
{
  "to": "chat" | "settings.general" | "settings.images" | "settings.keybindings" | "workspace" | "login" | "register" | "/absolute/path",
  "path": "/absolute/path",
  "params": { "anyRouteParam": "value" },
  "search": { "key": "value" },
  "hash": "section-id",
  "replace": true
}
```

`canRun`:
- always true for valid alias/absolute path values.

Result:
```json
{ "routePath": "/chat" }
```

### `coordinator.open_dialog`
Description: Open coordinator chat dialog from anywhere.

Params: `{}`

`canRun`:
- `isAuthenticated === true`

Result:
```json
{ "chatDialogOpen": true }
```

### `coordinator.close_dialog`
Description: Close coordinator chat dialog.

Params: `{}`

`canRun`:
- `chatDialogOpen === true`

Result:
```json
{ "chatDialogOpen": false }
```

## 5.2 Dialog and Chat Actions

### `coordinator.dialog.open_sessions_list`
Description: Switch coordinator dialog to sessions list mode.

Params: `{}`

`canRun`:
- `isAuthenticated === true`
- `chatDialogOpen === true`

Result:
```json
{ "mode": "sessions" }
```

### `coordinator.dialog.list_sessions`
Description: List coordinator sessions in dialog context.

Params:
```json
{ "limit": 20, "cursor": "string" }
```

`canRun`:
- `isAuthenticated === true`
- `chatDialogOpen === true`

Result:
```json
{
  "sessions": [
    {
      "id": "uuid",
      "title": "string|null",
      "createdBy": "uuid",
      "createdAt": "iso",
      "updatedAt": "iso"
    }
  ],
  "nextCursor": "string|null",
  "selectedSessionId": "uuid|null",
  "mode": "conversation|sessions",
  "isDraftingNewSession": false
}
```

### `coordinator.dialog.select_session`
Description: Select a coordinator session in dialog conversation view.

Params:
```json
{ "coordinatorSessionId": "uuid" }
```

`canRun`:
- `isAuthenticated === true`
- `chatDialogOpen === true`
- `chatStreaming === false`

Result:
```json
{ "selected": true, "coordinatorSessionId": "uuid", "mode": "conversation" }
```

### `coordinator.dialog.create_session`
Description: Create and select a new coordinator session in dialog.

Params:
```json
{ "title": "string" }
```

`canRun`:
- `isAuthenticated === true`
- `chatDialogOpen === true`
- `chatStreaming === false`

Result:
```json
{ "created": true, "coordinatorSessionId": "uuid", "mode": "conversation" }
```

### `chat.send_message`
Description: Send one user message in current coordinator conversation.

Params:
```json
{ "text": "string" }
```

Dialog UX note:
- Dialog composer is keyboard-first: `Enter` sends, `Shift+Enter` inserts newline.
- Dialog variant hides the send/stop icon button.

`canRun`:
- `isAuthenticated === true`
- (`routePath` starts with `/chat`) OR `chatDialogOpen === true`
- `chatHasConversation === true`
- `chatStreaming === false`

Result:
```json
{ "accepted": true, "streamingStarted": true }
```

### `chat.stop_stream`
Description: Stop currently streaming assistant response.

Params: `{}`

`canRun`:
- `chatStreaming === true`

Result:
```json
{ "stopped": true }
```

### `chat.rename_conversation`
Description: Rename active conversation title.

Params:
```json
{ "title": "string" }
```

`canRun`:
- `isAuthenticated === true`
- `chatHasConversation === true`
- chat page mode where title is visible/editable
- `chatStreaming === false`

Result:
```json
{ "renamed": true, "title": "new title" }
```

### `chat.delete_conversation`
Description: Delete active conversation from chat page context.

Params:
```json
{ "confirm": true }
```

`canRun`:
- `isAuthenticated === true`
- `chatHasConversation === true`
- delete control is present (page variant)

Result:
```json
{ "deleted": true, "redirectedTo": "/chat" }
```

### `chat.clear_dialog_conversation`
Description: Clear current dialog conversation via dialog clear flow.

Params:
```json
{ "confirm": true }
```

`canRun`:
- `isAuthenticated === true`
- `chatDialogOpen === true`
- `chatHasConversation === true`

Result:
```json
{ "cleared": true }
```

## 5.3 Settings - General

### `settings.general.set_name`
Description: Set display name input value.

Params:
```json
{ "name": "string" }
```

`canRun`:
- `isAuthenticated === true`
- `routePath === "/settings/general"`

Result:
```json
{ "name": "...", "dirty": true }
```

### `settings.general.set_default_region`
Description: Set default region input text.

Params:
```json
{ "regionText": "string" }
```

`canRun`:
- `isAuthenticated === true`
- `routePath === "/settings/general"`

Result:
```json
{ "regionText": "...", "dirty": true }
```

### `settings.general.save`
Description: Click Save on general settings page.

Params: `{}`

`canRun`:
- `isAuthenticated === true`
- `routePath === "/settings/general"`
- save button enabled (dirty and valid)

Result:
```json
{ "saved": true }
```

## 5.4 Settings - Images List

### `settings.images.open_detail`
Description: Open image detail page from images list.

Params:
```json
{ "imageId": "uuid" }
```

`canRun`:
- `isAuthenticated === true`
- `routePath === "/settings/images"`
- image exists in current rendered list

Result:
```json
{ "opened": true, "routePath": "/settings/images/<imageId>" }
```

## 5.5 Settings - Image Detail

### `settings.image_detail.set_name`
Params:
```json
{ "name": "string" }
```

`canRun`:
- `isAuthenticated === true`
- `routePath` matches `/settings/images/:imageId`
- `activeImageId !== null`
- `isBusy === false`

Result:
```json
{ "name": "...", "dirty": true }
```

### `settings.image_detail.set_description`
Params:
```json
{ "description": "string" }
```

`canRun`: same as `settings.image_detail.set_name`

Result:
```json
{ "description": "...", "dirty": true }
```

### `settings.image_detail.save`
Params: `{}`

`canRun`:
- detail route
- dirty draft exists
- validation passes
- not busy

Result:
```json
{ "saved": true }
```

### `settings.image_detail.revert`
Params: `{}`

`canRun`:
- detail route
- dirty draft exists
- not busy

Result:
```json
{ "reverted": true, "dirty": false }
```

### `settings.image_detail.clone`
Params: `{}`

`canRun`:
- detail route
- image loaded
- not busy

Result:
```json
{ "cloned": true, "newImageId": "uuid", "navigated": true }
```

### `settings.image_detail.build.start`
Params: `{}`

`canRun`:
- detail route
- image loaded
- build not already running

Result:
```json
{ "buildStarted": true }
```

### `settings.image_detail.build.stop`
Params: `{}`

`canRun`:
- detail route
- build is running

Result:
```json
{ "buildStopped": true }
```

### `settings.image_detail.archive`
Params:
```json
{ "confirm": true }
```

`canRun`:
- detail route
- not busy
- not already archived

Result:
```json
{ "archived": true, "routePath": "/settings/images/<imageId>" }
```

### `settings.image_detail.delete`
Params:
```json
{ "confirm": true }
```

`canRun`:
- detail route
- not busy
- image is archived

Result:
```json
{ "deleted": true, "redirectedTo": "/settings/images" }
```

## 5.6 Workspace Panels

Supported panel types (current registry):
- `coordinator`
- `agent_list`
- `agent_create`
- `agent_detail`
- `empty`

### `workspace.panel.open`
Description: Open a panel from the focused pane using workspace `panel/open` semantics.

Params:
```json
{
  "panelType": "coordinator" | "agent_list" | "agent_create" | "agent_detail" | "empty",
  "placement": "self" | "left" | "right" | "top" | "bottom",
  "config": {}
}
```

`canRun`:
- `isAuthenticated === true`
- `workspaceReady === true`
- `workspaceFocusedLeafId !== null`

Result:
```json
{
  "opened": true,
  "panelType": "agent_detail",
  "placement": "right",
  "panelInstanceId": "panel_x",
  "leafId": "leaf_x"
}
```

Notes:
1. `placement: "self"` replaces focused pane's panel.
2. `placement: "left" | "right" | "top" | "bottom"` reuses adjacent pane when present; otherwise creates a new split on that edge.

### `workspace.panel.list`
Description: List visible panels in current workspace window with deterministic IDs.

Params:
```json
{}
```

`canRun`:
- `isAuthenticated === true`
- `workspaceReady === true`

Result:
```json
{
  "panels": [
    {
      "panelInstanceId": "panel_x",
      "panelType": "agent_detail",
      "leafId": "leaf_x",
      "focused": true
    }
  ]
}
```

### `workspace.pane.focus`
Description: Focus an existing pane by `leafId` or `panelInstanceId`.

Params:
```json
{
  "target": "leaf" | "panel_instance",
  "leafId": "leaf_id",
  "panelInstanceId": "panel_id"
}
```

`canRun`:
- `isAuthenticated === true`
- `workspaceReady === true`

Result:
```json
{
  "focused": true,
  "leafId": "leaf_x",
  "panelInstanceId": "panel_x"
}
```

### `workspace.pane.move`
Description: Move one existing pane relative to another existing pane.

Params:
```json
{
  "fromLeafId": "leaf_id",
  "fromPanelInstanceId": "panel_id",
  "toLeafId": "leaf_id",
  "toPanelInstanceId": "panel_id",
  "placement": "left" | "right" | "top" | "bottom"
}
```

`canRun`:
- `isAuthenticated === true`
- `workspaceReady === true`

Result:
```json
{
  "moved": true,
  "fromLeafId": "leaf_from",
  "toLeafId": "leaf_to",
  "placement": "right",
  "focusedLeafId": "leaf_from"
}
```

### `workspace.pane.close`
Description: Close one existing pane by focused target, `leafId`, or `panelInstanceId`.

Params:
```json
{
  "target": "focused" | "leaf" | "panel_instance",
  "leafId": "leaf_id",
  "panelInstanceId": "panel_id"
}
```

`canRun`:
- `isAuthenticated === true`
- `workspaceReady === true`

Result:
```json
{
  "closed": true,
  "closedLeafId": "leaf_x",
  "closedPanelInstanceId": "panel_x",
  "focusedLeafId": "leaf_y"
}
```

Notes:
1. Close rejects if attempting to close the last remaining pane.

### `workspace.panel.set_config`
Description: Patch panel config by focused panel, first-of-type, or explicit `panelInstanceId`.

Params:
```json
{
  "target": "focused" | "first_of_type" | "panel_instance",
  "panelType": "coordinator" | "agent_list" | "agent_create" | "agent_detail" | "empty",
  "panelInstanceId": "panel_id",
  "patch": {}
}
```

`canRun`:
- `isAuthenticated === true`
- `workspaceReady === true`

Notes:
1. In `agent_detail` -> `session_detail`, composer input remains enabled while a run is streaming.
2. Streaming stop control is keyboard-driven (`Escape`) and via semantic action `chat.stop_stream` where applicable.

Result:
```json
{
  "updated": true,
  "panelType": "agent_detail",
  "panelInstanceId": "panel_x"
}
```

### `workspace.panel.resize`
Description: Resize focused pane's nearest width/height split.

Params:
```json
{
  "dimension": "width" | "height",
  "mode": "set_fraction" | "delta_fraction",
  "value": 0.5
}
```

`canRun`:
- `isAuthenticated === true`
- `workspaceReady === true`
- `workspaceFocusedLeafId !== null`

Result:
```json
{
  "resized": true,
  "splitId": "split_x",
  "ratio": 0.5,
  "dimension": "width"
}
```

### `workspace.sessions_panel.open`
Description: Open the left Sessions side panel on the workspace route.

Params:
```json
{}
```

`canRun`:
- `isAuthenticated === true`
- `routePath === "/"`
- `workspaceReady === true`

Result:
```json
{
  "open": true,
  "widthPx": 320,
  "groupBy": "none",
  "filters": {
    "imageId": "",
    "agentId": "",
    "createdBy": "",
    "archived": "false",
    "status": "all",
    "updatedAtRange": "all",
    "createdAtRange": "all"
  },
  "hasActiveFilters": false
}
```

### `workspace.sessions_panel.close`
Description: Close the left Sessions side panel on the workspace route.

Params:
```json
{}
```

`canRun`:
- `isAuthenticated === true`
- `routePath === "/"`
- `workspaceReady === true`

Result:
```json
{
  "open": false,
  "widthPx": 320,
  "groupBy": "none",
  "filters": {
    "imageId": "",
    "agentId": "",
    "createdBy": "",
    "archived": "false",
    "status": "all",
    "updatedAtRange": "all",
    "createdAtRange": "all"
  },
  "hasActiveFilters": false
}
```

### `workspace.sessions_panel.set_filters`
Description: Patch one or more Sessions side panel filters.

Params:
```json
{
  "imageId": "string",
  "agentId": "string",
  "createdBy": "string",
  "archived": "all" | "true" | "false",
  "status": "string",
  "updatedAtRange": "all" | "24h" | "7d" | "30d" | "90d",
  "createdAtRange": "all" | "24h" | "7d" | "30d" | "90d"
}
```

`canRun`:
- `isAuthenticated === true`
- `routePath === "/"`
- `workspaceReady === true`

Result:
```json
{
  "open": true,
  "widthPx": 320,
  "groupBy": "status",
  "filters": {
    "imageId": "img_123",
    "agentId": "",
    "createdBy": "",
    "archived": "false",
    "status": "processing",
    "updatedAtRange": "7d",
    "createdAtRange": "all"
  },
  "hasActiveFilters": true
}
```

### `workspace.sessions_panel.set_group_by`
Description: Set Sessions side panel group-by mode.

Params:
```json
{
  "groupBy": "none" | "imageId" | "createdBy" | "status"
}
```

## 5.4 Workspace Command-Palette Actions

Coordinator action IDs also include the workspace command-palette action IDs so the same action IDs are shared between keybindings, palette execution, and coordinator execution.

These workspace-facing action definitions are implemented in:
- `agent-manager-web/src/ui-actions/actions/keyboard-ui.ts`
- `agent-manager-web/src/ui-actions/actions/workspace-layout.ts`
- `agent-manager-web/src/ui-actions/actions/workspace-panels.ts`
- `agent-manager-web/src/ui-actions/actions/workspace-ui.ts`

The workspace palette/help/settings surfaces remain intentionally filtered to the workspace-facing subset (`surfaces.keyboard || surfaces.palette`) even though coordinator can execute the same underlying actions through `ui_run_action`.

These action IDs are:

- `keyboard.help.open`
- `keyboard.palette.open`
- `keyboard.leader.send`
- `keyboard.mode.cancel`
- `pane.split.down`
- `pane.split.right`
- `pane.split.down.full`
- `pane.split.right.full`
- `pane.close`
- `pane.zoom.toggle`
- `pane.focus.next`
- `pane.focus.last`
- `pane.focus.left`
- `pane.focus.right`
- `pane.focus.up`
- `pane.focus.down`
- `pane.number_mode.open`
- `pane.swap.prev`
- `pane.swap.next`
- `pane.rotate`
- `pane.break_to_window`
- `pane.resize.left`
- `pane.resize.right`
- `pane.resize.up`
- `pane.resize.down`
- `pane.type.prev`
- `pane.type.next`
- `pane.agent_view.prev`
- `pane.agent_view.next`
- `window.create`
- `window.close`
- `window.rename`
- `window.next`
- `window.prev`
- `window.last`
- `window.switcher.open`
- `window.select_index`
- `layout.cycle`
- `layout.equalize`
- `workspace.sessions_panel.toggle`
- `workspace.sessions_panel.focus_filter`
- `workspace.collapsibles.toggle_all`
- `workspace.coordinator.open`
- `workspace.stream.cancel`
- `settings.open.general`
- `settings.open.images`
- `settings.open.keybindings`

`canRun`:
- `isAuthenticated === true`
- `routePath === "/"`
- `workspaceReady === true`

Result:
```json
{
  "open": true,
  "widthPx": 320,
  "groupBy": "status",
  "filters": {
    "imageId": "img_123",
    "agentId": "",
    "createdBy": "",
    "archived": "false",
    "status": "processing",
    "updatedAtRange": "7d",
    "createdAtRange": "all"
  },
  "hasActiveFilters": true
}
```

## 6. Selector and Locator Strategy

Semantic actions should not expose selectors to the planner. Executor owns selectors.

Priority order for element targeting:
1. `data-testid` (preferred)
2. ARIA role + accessible name
3. deterministic fallback selectors (last resort)

Required action reliability work:
1. Add test IDs to critical controls for all V1 actions.
2. Keep test ID names stable and documented.

## 7. Execution Semantics
1. Validate action ID exists.
2. Validate params against schema.
3. Evaluate `canRun` with fresh context.
4. Execute action.
5. Verify success condition.
6. Return typed result envelope.

All actions must be idempotent where practical, or report non-idempotent behavior clearly in `description`.

## 8. Timeouts and Retries
1. Default action timeout: `10_000ms`.
2. Long-running actions (build start, navigation): up to `30_000ms`.
3. Retry policy:
- No implicit UI retries inside executor except for short locator stabilization polling.
- Agent decides whether to retry via another action call.

## 9. Runtime File Layout
- `shared/ui-actions-contract.ts`
- `shared/coordinator-actions-contract.ts`
- `agent-manager-web/src/ui-actions/types.ts`
- `agent-manager-web/src/ui-actions/context.ts`
- `agent-manager-web/src/ui-actions/registry.ts`
- `agent-manager-web/src/ui-actions/execute.ts`
- `agent-manager-web/src/ui-actions/actions/*.ts`
- `agent-manager-web/src/coordinator-actions/registry.ts`
- `agent-manager-web/src/coordinator-actions/executor.ts`

## 10. Unified Action State
Current action IDs are managed in `shared/ui-actions-contract.ts`.

Coordinator discovery and execution are filtered to actions where `surfaces.coordinator === true`, via:
1. `shared/coordinator-actions-contract.ts`
2. `agent-manager-web/src/coordinator-actions/registry.ts`
3. `agent-manager-web/src/coordinator-actions/executor.ts`

Runtime registry and coordinator subset must match the shared contracts exactly.
