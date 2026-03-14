# Client Tool TODO

This file tracks the remaining implementation work after removing the legacy
coordinator-run transport.

## Current Baseline

- [x] Keep using the live frontend session path:
  - `CoordinatorSessionDialog`
  - `CoordinatorAgentShell`
  - `AgentSessionPanel`
  - `agent-go /session/*`
- [x] Treat the remaining `coordinator-actions/*` runtime files as frontend
      runtime infrastructure, not backend coordinator transport.

## Shared Contract

- [x] Add a new shared client-tool transport contract in `shared/`.
- [x] Define the MCP-facing `client_tool_request` input:
  - `toolName`
  - `args`
  - `userId`
  - `deviceId`
- [x] Define server-to-client event payload types:
  - `client_tool_request`
  - `client_tool_cancel`
- [x] Define client registration payload types.
- [x] Define client response payload types.
- [x] Define shared client-tool error envelope types.
- [x] Define the initial tool-name set:
  - `ui_get_state`
  - `ui_list_available_actions`
  - `ui_run_action`
  - `add_secret`

## agent-go Server

- [x] Add client-tool registration endpoints to `agent-go`.
- [x] Add client-tool response endpoint to `agent-go`.
- [x] Add optional client-tool cancel endpoint to `agent-go`.
- [x] Extend `GET /session/{id}/message/{runId}/stream` to emit:
  - `client_tool_request`
  - `client_tool_cancel`
- [x] Add in-memory registration tracking keyed by `userId + deviceId`.
- [x] Add in-memory pending request tracking keyed by `requestId`.
- [x] Validate that the requested `deviceId` exists for the provided `userId`.
- [x] Validate that the target device advertises the requested `toolName`.
- [x] Ensure only the targeted `userId + deviceId` can satisfy a pending
      request.
- [x] Reject duplicate responses.
- [x] Reject responses for resolved or cancelled requests.
- [x] Implement request cancellation in the run manager.
- [x] Treat all in-flight client-tool requests as cancelled on server restart.

## agent-go MCP

- [x] Add the internal MCP server or MCP tool registration point inside
      `agent-go`.
- [x] Expose a single MCP tool: `client_tool_request`.
- [x] Define its `inputSchema`.
- [x] Define its `outputSchema`.
- [x] Make the MCP tool block until success, error, or cancellation.
- [x] Route MCP tool calls into the client-tool pending request manager.

## Frontend Transport

- [x] Add frontend client-tool registration logic for the current authenticated
      user.
- [x] Generate and persist a stable `deviceId` in browser storage.
- [x] Register supported tool names on attach/startup.
- [x] Re-register when auth state changes.
- [x] Unregister on logout or unload on a best-effort basis.
- [x] Add a client-tool stream handler on top of the `agent-go` session/run
      stream.
- [x] Handle `client_tool_request` events from `agent-go`.
- [x] Handle `client_tool_cancel` events from `agent-go`.
- [x] Post terminal tool results back to `agent-go`.

## Frontend Execution

- [x] Create a neutral frontend module for client-tool transport, for example:
  - `agent-manager-web/src/client-tools/contract.ts`
  - `agent-manager-web/src/client-tools/executor.ts`
  - `agent-manager-web/src/client-tools/stream-handler.ts`
  - `agent-manager-web/src/client-tools/device-registration.ts`
- [x] Move or wrap the surviving coordinator-named runtime pieces behind that
      neutral module boundary.
- [x] Implement `ui_get_state` using the existing frontend runtime snapshot
      logic.
- [x] Implement `ui_list_available_actions` using the existing semantic UI
      action registry.
- [x] Implement `ui_run_action` using the existing semantic UI action executor.
- [x] Implement `add_secret` on the client side.
- [x] Decide where client-side secret storage lives in v1.

## Frontend Integration

- [x] Integrate the new client-tool stream handler into
      `agent-manager-web/src/workspace/panels/agent-session.tsx` or a shared
      module used by it.
- [x] Do not introduce a second browser-facing stream.
- [x] Keep using the existing `agent-go` run stream as the delivery channel.

## Rename / Re-home

- [x] Rename `coordinator-actions/runtime-bridge.ts` to a neutral runtime name.
- [x] Rename `coordinator-actions/types.ts` to a neutral runtime name.
- [x] Decide whether `coordinator-actions/workspace-bridge.tsx` should also
      move.
- [x] Update imports in:
  - `agent-manager-web/src/routes/root.tsx`
  - `agent-manager-web/src/routes/workspace.tsx`
  - `agent-manager-web/src/routes/settings-general.tsx`
  - `agent-manager-web/src/routes/settings-images.tsx`
  - `agent-manager-web/src/routes/settings-image-detail.tsx`
  - `agent-manager-web/src/ui-actions/context.ts`
  - `agent-manager-web/src/ui-actions/actions/navigation.ts`
  - `agent-manager-web/src/components/coordinator-session-dialog.tsx`
  - `agent-manager-web/src/components/coordinator-agent-shell.tsx`
  - `agent-manager-web/src/workspace/ui/workspace-view.tsx`
  - `agent-manager-web/src/workspace/ui/workspace-hotkeys-layer.tsx`
  - `agent-manager-web/src/workspace/panels/agent-session.tsx`

## Docs Cleanup

- [x] Update stale coordinator docs to reflect the removed transport.
- [x] Remove references to deleted files from docs.
- [x] Update `CLIENT_TOOL_SPEC.md` as implementation details become concrete.
- [ ] Update `agent-manager/src/services/README.md` to reflect removal of the
      old coordinator session service surface.
- [x] Update workspace docs that still reference deleted coordinator transport
      files.

## Seed / Legacy Artifact Cleanup

- [ ] Re-run generation for agent-manager-tools via commands in agent-manager-client
- [ ] Update coordinator seed docs that still reference deleted transport
      files.

## Validation

- [x] Verify `agent-go` can emit `client_tool_request` on a live run stream.
- [ ] Verify a browser client can register `userId + deviceId`.
- [ ] Verify the browser receives a targeted request.
- [ ] Verify the browser can respond successfully.
- [x] Verify duplicate responses are rejected.
- [x] Verify cancelled requests reject late responses.
- [ ] Verify `ui_get_state` works end-to-end.
- [ ] Verify `ui_list_available_actions` works end-to-end.
- [ ] Verify `ui_run_action` works end-to-end.
- [ ] Verify `add_secret` works end-to-end.
- [ ] Verify cross-device routing works by switching `deviceId` between
      requests.
