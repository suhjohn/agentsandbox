# Client Tool Spec

## Purpose

This document defines the client tool transport used by `agent-go` to let
runtime harnesses access capabilities that only exist on an attached client
device.

The transport is named **client_tool**.

Client tool transport replaces the old coordinator-specific framing. It is the
server-owned mechanism by which code under
[`agent-go/internal/harness/`](/Users/johnsuh/agentdesktop/agent-go/internal/harness)
can request client-executed work and block until the client returns a result.

## Core Model

There are three different roles:

1. `agent-go`
   Owns the client tool runtime, request tracking, routing, cancellation, and
   result resolution.
2. Harness runtime
   Uses an internal MCP server exposed by `agent-go` to request client work.
   Codex is the first MCP client. Pi may later consume the same capability
   through a translation layer from MCP servers to custom tools.
3. Attached frontend client
   Registers which client tools it can execute for a specific
   `user_id + device_id`, receives requests from `agent-go`, executes them
   locally, and posts responses back to `agent-go`.

The frontend is not the MCP client in this design. The harness is.

## Scope

The first implementation must support:

- `ui_get_state`
- `ui_list_available_actions`
- `ui_run_action`
- `add_secret`

The transport itself remains generic and must not be specialized around `ui_*`.

## Non-Goals

- Recreating frontend-owned semantic UI behavior inside `agent-go`
- Exposing every client tool as its own MCP tool
- Reintroducing coordinator-specific transport naming
- Changing the current permission model for session streaming, message
  streaming, or message fetching
- Adding request timeouts

## Architecture

### Internal MCP surface

`agent-go` hosts an internal MCP server used by harnesses.

That MCP server exposes a single tool:

- `client_tool_request`

The tool accepts a generic request envelope containing the actual client tool
name and JSON arguments. This keeps the MCP surface stable while allowing the
frontend-owned client tool set to evolve independently.

### Client registration surface

Attached clients register:

- `user_id`
- `device_id`
- supported tool names
- optional metadata describing the device

Registration is scoped to the `user_id + device_id` combination, not to a
single run.

The `device_id` should be stable for a given browser/device. In the web client,
the minimum acceptable implementation is a generated identifier persisted in
local storage.

### Request execution model

1. A harness invokes `client_tool_request` through the internal MCP server.
2. `agent-go` validates the request and chooses a compatible attached device.
3. `agent-go` emits a pending client tool request on the run stream.
4. A compatible attached client receives the request.
5. The client executes the named tool locally.
6. The client posts a structured response back to `agent-go`.
7. `agent-go` resolves the pending request and returns the result to the
   harness.

The server blocks until the selected client responds or the request is
cancelled. There is no timeout in v1.

## Naming

All new transport naming should use **client_tool** instead of
**coordinator** when referring to this server-owned client tool mechanism.

This rename is conceptual and architectural. Existing product UI names may
continue to use "coordinator" until they are migrated separately.

## MCP Contract

### MCP model

The internal MCP server should follow the normal MCP server pattern:

- the harness discovers tools through `tools/list`
- the harness invokes a tool through `tools/call`
- each tool is defined by a name, description, and `inputSchema`

The client tool MCP server exposes exactly one MCP tool in v1:

- `client_tool_request`

The actual client capability being invoked is not an MCP tool. It is an
application-level argument to `client_tool_request`.

### MCP tool definition

`tools/list` should advertise `client_tool_request` as a normal MCP tool
definition:

```json
{
  "name": "client_tool_request",
  "title": "Client Tool Request",
  "description": "Request execution of a named client-side tool on an attached device and wait until the device returns a terminal result.",
  "inputSchema": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "toolName": {
        "type": "string",
        "description": "The registered client tool to execute, such as ui_get_state, ui_list_available_actions, ui_run_action, or add_secret."
      },
      "args": {
        "description": "JSON-serializable arguments forwarded to the named client tool."
      },
      "userId": {
        "type": "string",
        "description": "The user identity that owns the target client registration."
      },
      "deviceId": {
        "type": "string",
        "description": "The target client device identifier."
      }
    },
    "required": ["toolName", "args", "userId", "deviceId"]
  },
  "outputSchema": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "ok": {
        "type": "boolean"
      },
      "result": {},
      "error": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "code": {
            "type": "string"
          },
          "message": {
            "type": "string"
          },
          "retryable": {
            "type": "boolean"
          }
        },
        "required": ["code", "message", "retryable"]
      }
    },
    "required": ["ok"],
    "allOf": [
      {
        "if": {
          "properties": {
            "ok": { "const": true }
          },
          "required": ["ok"]
        },
        "then": {
          "required": ["result"]
        }
      },
      {
        "if": {
          "properties": {
            "ok": { "const": false }
          },
          "required": ["ok"]
        },
        "then": {
          "required": ["error"]
        }
      }
    ]
  }
}
```

### MCP call examples

Example `tools/call` arguments for a UI request:

```json
{
  "toolName": "ui_list_available_actions",
  "args": {},
  "userId": "user_123",
  "deviceId": "device_macbook_abc"
}
```

Example `tools/call` arguments for a non-UI request:

```json
{
  "toolName": "add_secret",
  "args": {
    "key": "OPENAI_API_KEY",
    "value": "sk-..."
  },
  "userId": "user_123",
  "deviceId": "device_phone_xyz"
}
```

### MCP result contract

The MCP tool result should use normal MCP tool result fields:

- `structuredContent` for the typed response object
- `content` with a serialized text form of that object for compatibility

The object in `structuredContent` must conform to `outputSchema`.

Example success result:

```json
{
  "content": [
    {
      "type": "text",
      "text": "{\"ok\":true,\"result\":{\"actions\":[]}}"
    }
  ],
  "structuredContent": {
    "ok": true,
    "result": {
      "actions": []
    }
  }
}
```

Example error result:

```json
{
  "content": [
    {
      "type": "text",
      "text": "{\"ok\":false,\"error\":{\"code\":\"CLIENT_TOOL_EXECUTION_FAILED\",\"message\":\"Client failed to execute tool\",\"retryable\":false}}"
    }
  ],
  "structuredContent": {
    "ok": false,
    "error": {
      "code": "CLIENT_TOOL_EXECUTION_FAILED",
      "message": "Client failed to execute tool",
      "retryable": false
    }
  }
}
```

### MCP tool behavior

- `client_tool_request` is the only MCP tool exposed in v1.
- `toolName` is required and refers to a client-registered capability.
- `args` must be JSON-serializable and valid for the named client tool.
- `userId` is required and identifies the owner of the targeted client
  registration.
- `deviceId` is required and identifies the exact target device.
- The MCP call blocks until a response or cancellation.
- `agent-go` must validate that `deviceId` is registered for `userId`.
- `agent-go` must validate that the target device supports `toolName`.
- `agent-go` dispatches only to the specified `userId + deviceId` target.

## Server-Side Transport Contract

These are transport-level shapes between `agent-go` and attached clients. The
exact API routes may evolve, but these fields define the contract.

### Client tool request event

```json
{
  "type": "client_tool_request",
  "runId": "run_123",
  "request": {
    "requestId": "ctr_123",
    "toolName": "ui_run_action",
    "args": {
      "actionId": "nav.go",
      "params": {
        "to": "/workspace"
      }
    },
    "targetDeviceId": "device_macbook_abc",
    "cancellable": true
  }
}
```

### Client tool response submission

```json
{
  "requestId": "ctr_123",
  "deviceId": "device_macbook_abc",
  "ok": true,
  "result": {
    "didRun": true
  }
}
```

### Client tool error submission

```json
{
  "requestId": "ctr_123",
  "deviceId": "device_macbook_abc",
  "ok": false,
  "error": {
    "code": "INVALID_ARGS",
    "message": "Invalid ui_run_action args",
    "retryable": false
  }
}
```

### Client tool cancellation event

```json
{
  "type": "client_tool_cancel",
  "runId": "run_123",
  "requestId": "ctr_123",
  "targetDeviceId": "device_macbook_abc"
}
```

### Client registration

```json
{
  "userId": "user_123",
  "deviceId": "device_macbook_abc",
  "tools": [
    "ui_get_state",
    "ui_list_available_actions",
    "ui_run_action",
    "add_secret"
  ],
  "device": {
    "platform": "macOS",
    "label": "John's MacBook Pro"
  }
}
```

## Routing and Device Selection

Routing must be device-aware.

Registration is keyed by `user_id + device_id`.

The intended behavior is:

- requests explicitly target a `user_id + device_id` combination
- the device must be registered for that user
- the device must advertise support for the requested tool
- the resolved target must be encoded into the pending request

The design must also support device handoff during a run.

Example:

1. The run starts while the user is on a laptop.
2. The laptop is the active responding device.
3. The user later opens the same run on a phone.
4. The phone registers its `device_id` and supported tools.
5. Future requests may target the phone instead of the laptop.

This handoff must not require changing existing permissions around who can
stream runs or fetch messages.

## Override Semantics

The transport must support a later-attached device becoming the selected device
for future requests in the same run when the harness chooses that device in a
subsequent MCP call.

At minimum:

- device selection is explicit per request, not frozen for the entire run
- a newly attached compatible device may become the target for subsequent
  requests by using its `deviceId`
- in-flight requests remain bound to the device selected when they were issued,
  unless explicit reassignment support is added later

This keeps the first implementation predictable while still supporting real
cross-device movement.

## Cancellation

Cancellation is required in v1.

The transport must support:

- server-initiated cancellation of a pending client tool request
- notifying the targeted device that the request was cancelled
- rejecting any later response for a cancelled request

Cancellation does not imply timeout. Requests remain open indefinitely until
they succeed, fail, or are cancelled.

## Validation Rules

### Server must

- reject requests for unknown client tool names when policy requires explicit
  registration
- reject dispatch when the specified `userId + deviceId` registration does not
  exist
- reject dispatch when the specified device does not support the requested tool
- record the concrete target user and device for each pending request
- ensure only the targeted device can satisfy a pending request
- reject duplicate responses for the same pending request
- reject responses for unknown requests
- reject responses for already-resolved or cancelled requests
- support cancellation of pending requests
- preserve existing auth and permission rules for stream and fetch APIs

### Client must

- only register tools it can actually execute
- preserve `requestId`
- include its `deviceId` in responses
- submit exactly one terminal response per request
- stop work when a cancellation event is received when feasible

## Tool Namespaces

The transport remains generic, but tool names stay explicit.

Initial namespaces:

- `ui_*`
- `add_secret`

`add_secret` is intentionally included in v1 so the system proves it can support
non-UI client capabilities without changing the transport design.

## Shared Types Recommendation

The generic client tool transport envelope should live in `shared/`.

Recommended shared ownership:

- request/response envelope types
- registration payload types
- cancellation payload types
- common error envelope types

Recommended local ownership:

- domain-specific `args` and `result` schemas for frontend-owned `ui_*` tools
- implementation-specific runtime storage and routing structures in `agent-go`

Reasoning:

- the transport is a cross-boundary contract between `agent-go` and clients
- drift risk is high if the envelope types are defined separately
- domain-specific behavior should remain close to the code that owns it

## Suggested `agent-go` Responsibilities

- host the internal client tool MCP server
- expose `client_tool_request`
- track registered devices per `user_id + device_id`
- map authenticated run context to eligible devices
- emit `client_tool_request` and `client_tool_cancel` events on the run stream
- accept client tool responses
- resolve blocked harness requests
- persist enough request state to reject stale or duplicate responses correctly

## Suggested Client Responsibilities

- generate and persist a stable `device_id`
- register supported tools after attachment
- listen for client tool request and cancellation events
- execute the requested tool locally
- submit structured success or error responses

## Current Architecture vs Target

The current frontend architecture now has one relevant live path for this work.

### Current `agent-go` session path

This path is already backed by `agent-go` and is the correct long-term home for
client tool transport.

Flow:

1. The user opens the coordinator dialog.
2. The dialog selects an agent and session through `agent-manager`.
3. The dialog renders an `AgentSessionPanel`.
4. `AgentSessionPanel` talks to `agent-go` session APIs.

Current route surface in `agent-go`:

- `POST /session`
- `GET /session`
- `GET /session/{id}`
- `POST /session/{id}/message`
- `GET /session/{id}/stream`
- `GET /session/{id}/message/{runId}/stream`
- `POST /session/{id}/stop`
- `DELETE /session/{id}`

Relevant files:

- [`agent-go/internal/server/serve.go`](/Users/johnsuh/agentdesktop/agent-go/internal/server/serve.go)
- [`agent-manager-web/src/components/coordinator-session-dialog.tsx`](/Users/johnsuh/agentdesktop/agent-manager-web/src/components/coordinator-session-dialog.tsx)
- [`agent-manager-web/src/workspace/panels/agent-session.tsx`](/Users/johnsuh/agentdesktop/agent-manager-web/src/workspace/panels/agent-session.tsx)

Diagram:

```text
CoordinatorSessionDialog
  -> agent-manager: list/select coordinator agents + sessions
  -> renders AgentSessionPanel
  -> AgentSessionPanel talks to agent-go /session/*
```

### Target path

The client tool transport should be added to the existing `agent-go`
session/run stream path.

Target flow:

1. Harness calls internal MCP tool `client_tool_request`.
2. `agent-go` emits `client_tool_request` on the session run stream.
3. The frontend session runtime receives the event from the `agent-go` run
   stream.
4. The frontend executes the local client tool.
5. The frontend posts the terminal result to `agent-go`.
6. `agent-go` resolves the blocked MCP call.

Diagram:

```text
Codex
  -> MCP client_tool_request(toolName, args, userId, deviceId)
  -> agent-go
  -> emit client_tool_request on /session/{id}/message/{runId}/stream
  -> frontend session runtime executes local tool
  -> POST /client-tools/respond
  -> agent-go resolves MCP tool call
```

## Implementation Details

### API surface

The internal MCP server is not exposed as a browser-facing HTTP API. It is used
internally by harnesses inside `agent-go`.

The attached client needs a separate HTTP API surface for registration and
responses.

#### `POST /client-tools/register`

Registers or refreshes a live client device registration.

Request body:

```json
{
  "userId": "user_123",
  "deviceId": "device_macbook_abc",
  "tools": [
    "ui_get_state",
    "ui_list_available_actions",
    "ui_run_action",
    "add_secret"
  ],
  "device": {
    "platform": "macOS",
    "label": "John's MacBook Pro"
  }
}
```

Behavior:

- upserts the live registration for `userId + deviceId`
- replaces the prior tool list for that device
- records a `lastSeenAt` timestamp
- does not change the session/message/run permission model

Response:

```json
{
  "ok": true
}
```

#### `POST /client-tools/unregister`

Best-effort removal of a live client device registration.

Request body:

```json
{
  "userId": "user_123",
  "deviceId": "device_macbook_abc"
}
```

Behavior:

- removes the live registration if present
- is idempotent

Response:

```json
{
  "ok": true
}
```

#### `POST /client-tools/respond`

Submits the terminal result for a pending client tool request.

Request body:

```json
{
  "requestId": "ctr_123",
  "userId": "user_123",
  "deviceId": "device_macbook_abc",
  "ok": true,
  "result": {
    "didRun": true
  }
}
```

Error example:

```json
{
  "requestId": "ctr_123",
  "userId": "user_123",
  "deviceId": "device_macbook_abc",
  "ok": false,
  "error": {
    "code": "INVALID_ARGS",
    "message": "Invalid ui_run_action args",
    "retryable": false
  }
}
```

Behavior:

- validates `requestId`
- validates that the request is still pending
- validates that `userId + deviceId` matches the targeted request
- resolves the blocked MCP call
- rejects duplicate or stale responses

Response:

```json
{
  "ok": true
}
```

#### `POST /client-tools/cancel`

Optional endpoint for client-initiated cancellation or cancellation
acknowledgement.

Request body:

```json
{
  "requestId": "ctr_123",
  "userId": "user_123",
  "deviceId": "device_macbook_abc",
  "reason": "user_cancelled"
}
```

Behavior:

- may be omitted in the first implementation if cancellation is server-only
- if implemented, it must validate the targeted request identity
- marks the request cancelled if it is still pending

Response:

```json
{
  "ok": true
}
```

### Stream integration

No separate client-tool event stream is required in v1.

Existing run streaming should carry these additional event types:

- `client_tool_request`
- `client_tool_cancel`

This preserves the current session/message stream permission model.

Concretely, this means extending the `agent-go` run stream exposed at:

- `GET /session/{id}/message/{runId}/stream`

The frontend should consume these events from the same `agent-go` stream it
already uses for agent-backed session execution. No separate browser-facing
stream should be introduced in v1.

### In-memory runtime state

`agent-go` should maintain these live runtime structures in memory in v1:

- `deviceRegistrationsByUser`
  Maps `userId -> deviceId -> registration`
- `pendingClientToolRequests`
  Maps `requestId -> pending request state`
- `runPendingRequests`
  Maps `runId -> set of requestIds`

Suggested pending request fields:

- `requestId`
- `runId`
- `toolName`
- `args`
- `userId`
- `deviceId`
- `status`
- `createdAt`
- `cancelledAt`
- `resultCh` or equivalent waiter/resolver handle

Suggested device registration fields:

- `userId`
- `deviceId`
- `tools`
- `deviceMetadata`
- `lastSeenAt`

### Request lifecycle

1. Harness calls MCP tool `client_tool_request`.
2. `agent-go` validates `toolName`, `args`, `userId`, and `deviceId`.
3. `agent-go` verifies that the `userId + deviceId` registration exists.
4. `agent-go` verifies that the target device advertises the requested tool.
5. `agent-go` creates a pending request record.
6. `agent-go` emits `client_tool_request` on the existing run stream.
7. Target client executes the request locally.
8. Client posts terminal result to `POST /client-tools/respond`.
9. `agent-go` validates the responder identity and resolves the pending request.
10. MCP call returns the structured result to the harness.

### Cancellation lifecycle

1. Server decides to cancel a pending request.
2. `agent-go` marks the pending request as cancelled.
3. `agent-go` emits `client_tool_cancel` on the run stream.
4. Client stops work when feasible.
5. Any later response for that request is rejected.

### Authentication and authorization

The spec does not introduce a new permission model.

Implementation requirements:

- registration, response, and cancellation endpoints must require the same user
  identity context already used by the current app
- a client may only register devices for its authenticated user
- a client may only respond to requests targeted at its authenticated user and
  claimed `deviceId`
- existing access rules for session streaming, message streaming, and message
  fetching remain unchanged

## Frontend Integration

### `agent-manager-web` strategy

The frontend should keep its local execution/runtime infrastructure and attach
client-tool handling to the `agent-go` session/run stream.

The important architectural distinction is:

- local UI execution is still needed
- legacy coordinator-run transport has already been removed from the current
  codebase

### Files already removed from the old transport path

These files were part of the deleted legacy coordinator-run transport and are
no longer part of the status quo.

- `agent-manager-web/src/routes/chat-conversation.tsx`
- `agent-manager-web/src/coordinator-actions/executor.ts`
- `agent-manager-web/src/coordinator-actions/context.ts`
- `agent-manager-web/src/coordinator-actions/browser-tools.ts`
- `agent-manager-web/src/coordinator-actions/registry.ts`
- `shared/coordinator-client-tools-contract.ts`
- `agent-manager/src/services/coordinator-session.service.ts`

### Files to keep but rename or re-home

These are still useful, but their current `coordinator-*` naming is misleading.

- [`agent-manager-web/src/coordinator-actions/runtime-bridge.ts`](/Users/johnsuh/agentdesktop/agent-manager-web/src/coordinator-actions/runtime-bridge.ts)
  Keep the runtime controller registry, but rename it to a neutral runtime
  bridge module.
- [`agent-manager-web/src/coordinator-actions/types.ts`](/Users/johnsuh/agentdesktop/agent-manager-web/src/coordinator-actions/types.ts)
  Keep and move alongside the renamed runtime/executor modules.
- [`agent-manager-web/src/coordinator-actions/actions/`](/Users/johnsuh/agentdesktop/agent-manager-web/src/coordinator-actions/actions)
  Keep the action implementations, but re-home them if the module tree is
  renamed.

### Files to keep

These remain valid in the target architecture.

- [`agent-manager-web/src/components/coordinator-session-dialog.tsx`](/Users/johnsuh/agentdesktop/agent-manager-web/src/components/coordinator-session-dialog.tsx)
  Keep if the coordinator dialog remains a product surface. It is a host UI,
  not the deprecated transport engine.
- [`agent-manager-web/src/workspace/panels/agent-session.tsx`](/Users/johnsuh/agentdesktop/agent-manager-web/src/workspace/panels/agent-session.tsx)
  Keep. This is the correct place, or the best current place, to integrate the
  new `agent-go` client-tool stream handling.
- [`agent-manager-web/src/ui-actions/context.ts`](/Users/johnsuh/agentdesktop/agent-manager-web/src/ui-actions/context.ts)
- [`agent-manager-web/src/ui-actions/execute.ts`](/Users/johnsuh/agentdesktop/agent-manager-web/src/ui-actions/execute.ts)

### Files that need import updates

These files currently import `coordinator-actions/*` infrastructure and likely
need import updates after the rename/re-home.

- [`agent-manager-web/src/routes/root.tsx`](/Users/johnsuh/agentdesktop/agent-manager-web/src/routes/root.tsx)
- [`agent-manager-web/src/routes/workspace.tsx`](/Users/johnsuh/agentdesktop/agent-manager-web/src/routes/workspace.tsx)
- [`agent-manager-web/src/routes/settings-general.tsx`](/Users/johnsuh/agentdesktop/agent-manager-web/src/routes/settings-general.tsx)
- [`agent-manager-web/src/routes/settings-images.tsx`](/Users/johnsuh/agentdesktop/agent-manager-web/src/routes/settings-images.tsx)
- [`agent-manager-web/src/routes/settings-image-detail.tsx`](/Users/johnsuh/agentdesktop/agent-manager-web/src/routes/settings-image-detail.tsx)
- [`agent-manager-web/src/workspace/ui/workspace-view.tsx`](/Users/johnsuh/agentdesktop/agent-manager-web/src/workspace/ui/workspace-view.tsx)
- [`agent-manager-web/src/workspace/ui/workspace-hotkeys-layer.tsx`](/Users/johnsuh/agentdesktop/agent-manager-web/src/workspace/ui/workspace-hotkeys-layer.tsx)
- [`agent-manager-web/src/workspace/panels/agent-session.tsx`](/Users/johnsuh/agentdesktop/agent-manager-web/src/workspace/panels/agent-session.tsx)
- [`agent-manager-web/src/components/coordinator-session-dialog.tsx`](/Users/johnsuh/agentdesktop/agent-manager-web/src/components/coordinator-session-dialog.tsx)

### Recommended frontend module shape

The cleanest target split is:

1. `client-tools/`
   Owns:
   - device registration with `agent-go`
   - request/response transport
   - stream event handling for `client_tool_request` and `client_tool_cancel`
   - client tool contract validation
2. `ui-actions/`
   Owns:
   - `ui_get_state`
   - `ui_list_available_actions`
   - `ui_run_action`
   - runtime controllers
   - semantic UI execution

### Recommended integration point

The browser-side client-tool handler should live in
[`agent-manager-web/src/workspace/panels/agent-session.tsx`](/Users/johnsuh/agentdesktop/agent-manager-web/src/workspace/panels/agent-session.tsx)
or a shared module used by it, because that panel already owns the `agent-go`
session/run stream lifecycle.

## Open Questions

These points are resolved for v1:

1. Default targeting
   There is no default targeting rule in v1. The MCP caller must provide both
   `userId` and `deviceId` in every `client_tool_request` call.
2. Device override behavior
   There is no separate override API in v1. A later-attached device becomes the
   target for future requests only when the MCP caller chooses that device by
   sending its `deviceId` in a subsequent `client_tool_request` call.
3. Persistence model
   Pending request state and live device registrations are in-memory only in v1.
   On server restart:
   - all pending client tool requests are treated as cancelled
   - clients must reconnect and re-register their supported tools
   - stale post-restart responses must be rejected as unknown or cancelled
4. `add_secret` v1 contract
   `add_secret` is a named client tool with this initial application contract.

   Arguments:

   ```json
   {
     "name": "OPENAI_API_KEY",
     "value": "sk-...",
     "overwrite": false
   }
   ```

   Argument rules:

   - `name` is required
   - `value` is required
   - `overwrite` is optional and defaults to `false`

   Success result:

   ```json
   {
     "stored": true,
     "name": "OPENAI_API_KEY"
   }
   ```

   Error codes:

   - `SECRET_ALREADY_EXISTS`
   - `SECRET_STORAGE_UNAVAILABLE`
   - `INVALID_SECRET_NAME`
   - `USER_CANCELLED`

## Success Criteria

1. A harness in `agent-go/internal/harness/**` can call the internal MCP tool
   `client_tool_request`.
2. `agent-go` can dispatch that request to a compatible attached client device.
3. The client can execute `ui_*` tools and `add_secret` locally and submit the
   result back.
4. The harness call unblocks with the client-provided result.
5. Device registration is keyed by `user_id + device_id`.
6. Device handoff during a run works for future requests without altering the
   existing stream/fetch permission model.
7. Pending requests can be cancelled.
