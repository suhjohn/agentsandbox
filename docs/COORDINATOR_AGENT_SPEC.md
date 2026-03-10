# COORDINATOR_AGENT_SPEC

## 1. Purpose
Define a robust coordinator-agent architecture that can:
- Execute manager/coordinator actions on the backend.
- Execute web UI actions on the frontend when a browser is available.
- Continue to function for backend-triggered/API-triggered runs where no browser exists.

This spec assumes a single planner agent loop (AI SDK) on the backend, with optional client-side action execution.

### 1.1 Why We Are Doing This
Today, the coordinator can reason and act through backend tools, but UI interaction is not first-class and reliable across contexts. We want the coordinator to behave like one consistent operator that can:
1. Use backend APIs and services when that is the best path.
2. Use frontend semantic UI actions when user-facing web interaction is needed.
3. Keep working even when no browser is attached (for API-triggered or background runs).

The purpose is to avoid splitting behavior into separate agent systems and to prevent brittle, screenshot-driven UI automation.

### 1.2 Problem This Solves
Without this design, we get one or more of these issues:
1. Tooling mismatch: backend runs cannot perform UI-required steps.
2. Reliability issues: raw click/screenshot automation is fragile.
3. Architecture drift: separate frontend/backend planners lead to inconsistent state and decision conflicts.
4. Operational gaps: reconnect/resume and ownership are harder to reason about when client actions are ad hoc.

### 1.3 Intended Outcome
After implementation, a single coordinator run should:
1. Plan once (backend AI SDK loop).
2. Choose server tools or client semantic actions based on capability and task needs.
3. Pause/resume safely when waiting for client action results.
4. Degrade gracefully to server-only behavior when browser access is unavailable.

### 1.4 Success Criteria (Product-Level)
This effort is successful when:
1. The same user prompt can be handled in browser-attached and browser-detached contexts without changing core planner architecture.
2. UI actions are semantic, typed, and auditable (not selector guessing by the model).
3. Failures are explicit and recoverable (timeouts, unavailable actions, disconnects).
4. Multi-process scaling remains possible via run ownership + shared coordination, without redesigning the planner model.

## 2. Goals
1. One agent loop, two execution planes:
- Server plane: coordinator/API/tools on backend.
- Client plane: UI/browser actions on frontend.
2. Deterministic, semantic UI actions (not screenshot-guessing).
3. Capability-aware behavior when browser is unavailable.
4. Resume-safe streaming and tool handshakes.
5. Scale path from single-process to multi-process backend.

## 3. Non-Goals
- Running a second independent top-level planner in the frontend.
- Full autonomous cross-origin browsing.
- Replacing existing coordinator streaming model.

## 4. Current Baseline (Today)
- Frontend chat uses:
  - `agent-manager-web/src/components/chat-dialog.tsx`
  - `agent-manager-web/src/routes/chat-conversation.tsx`
  - API client in `agent-manager-web/src/lib/api.ts`
- Backend coordinator routes:
  - `agent-manager/src/routes/coordinator.ts`
- Backend run/event manager:
  - `agent-manager/src/services/agent-run-manager.ts`
- Backend AI SDK orchestration:
  - `agent-manager/src/coordinator/index.ts`

Existing flow already supports streaming, run IDs, reconnect, persisted conversation messages, and tool call/result rendering.

## 5. Target Architecture

### 5.1 Core Principle
Keep a single backend AI SDK planner (`streamText`) and expose tools based on runtime capability.

### 5.2 Tool Planes
1. Server tools (always eligible when authorized)
- Existing coordinator tools (`coordinator_bash`, `coordinator_api_request`, file tools, manager API paths, etc.)
  - Default manager API transport: `coordinator_api_request` for all endpoint calls.
  - `coordinator_api_request` also supports absolute sandbox runtime URLs; manager bearer auth is only auto-applied for same-origin manager requests.
  - `coordinator_bash` is primarily for shell/discovery/diagnostics and non-API command execution.
2. Client tools (eligible only when browser is available)
- Semantic UI tools, executed by frontend executor.

### 5.3 Capability Flag
At run start, backend stores:
- `browserAvailable: boolean`

No `browser.sessionId` and no `browser.origin` are required.

## 6. High-Level UI Intents (Semantic Actions)

Detailed V1 action catalog, contracts, and availability model live in:
- `COORDINATOR_SEMANTIC_ACTIONS.md`
- Action ID/version source of truth for both frontend registry and backend planner prompt:
  - `shared/coordinator-actions-contract.ts` (base semantic actions including settings + workspace command-palette IDs)
- Client tool name/version source of truth for frontend/backend handshake:
  - `shared/coordinator-client-tools-contract.ts`

### 6.1 Why
Avoid brittle screenshot/HTML-driven clicking. Use code-aware intents with stable IDs and explicit preconditions.

### 6.2 Frontend Action Registry
Define a registry of actions (example):
- `coordinator.open_dialog`
- `coordinator.dialog.open_sessions_list`
- `coordinator.dialog.list_sessions`
- `coordinator.dialog.select_session`
- `coordinator.dialog.create_session`
- `coordinator.close_dialog`
- `chat.send_message`
- `workspace.pane.focus`
- `workspace.pane.move`
- `workspace.pane.close`
- `workspace.sessions_panel.open`
- `workspace.sessions_panel.set_filters`
- `workspace.sessions_panel.set_group_by`
- `workspace.sessions_panel.close`
- Workspace command-palette command IDs from `shared/coordinator-actions-contract.ts`, including pane/view cycling commands such as `pane.type.prev`, `pane.type.next`, `pane.agent_view.prev`, and `pane.agent_view.next`
- `settings.general.set_name`
- `settings.general.save`
- `settings.images.open_detail`
- `settings.image_detail.set_name`
- `settings.image_detail.save`
- workspace command-palette IDs (for example: `pane.split.right`, `window.create`, `layout.cycle`, `workspace.coordinator.open`, `settings.open.general`)

Each action includes:
- `id`
- `description`
- `paramsSchema`
- `canRun(ctx)` -> `{ ok: true } | { ok: false, reason }`
- `run(ctx, params)` -> structured result

### 6.3 Dynamic Availability
Action availability depends on current client state:
- Auth state
- Route/view
- Modal open/closed
- Element visibility/readiness

Frontend exposes available actions at execution time via a tool call response path.

### 6.4 Generic Browser Fallback Tools
When semantic actions cannot represent a task, backend may call generic browser fallback tools.

Initial fallback tool set:
- `ui_browser_navigate`
- `ui_browser_snapshot`
- `ui_browser_click`
- `ui_browser_type`
- `ui_browser_wait`
- `ui_browser_scroll`
- `ui_browser_eval`

Planner policy:
1. Prefer `ui_list_available_actions` + `ui_run_action`.
2. Use `ui_browser_*` only when no semantic action can complete the step.
3. Re-check semantic state with `ui_get_state` after fallback manipulations when correctness matters.

## 7. Backend-Frontend Tool Handshake

### 7.1 Request/Result Contract
When model calls a client tool:
1. Backend emits run event `client_tool_request` with:
- `runId`
- `toolCallId`
- `toolName`
- `args`
- `timeoutMs`
2. Frontend executes action and POSTs `client_tool_result`:
- `toolCallId`
- `ok`
- `result` (if `ok=true`)
- `error` (if `ok=false`)

### 7.2 Where Backend Waits
Backend waits inside the async client tool implementation in the AI SDK loop:
- `await requestClientToolAndWait(...)`
- Promise resolves when `client_tool_result` arrives.
- Then `streamText` continues next step.

This wait is inside tool execution, not in the HTTP route handler.

## 8. API and Event Additions

### 8.1 Route Additions
Add to coordinator routes:
1. `POST /coordinator/runs/:runId/tool-result`
- Auth required.
- Body: `{ toolCallId, ok, result?, error? }`
- Resolves a pending client-tool promise.

Optional (if explicit availability signaling is desired):
2. `POST /coordinator/runs/:runId/browser-availability`
- Body: `{ browserAvailable: boolean }`

### 8.2 Event Additions (SSE Payload)
Emit structured event payloads with a `type` field:
- `client_tool_request`
- `text_delta`
- `tool_call`
- `tool_result`
- `error`
- `done`

Note: Keep backward-compatible fields (`text`, `toolCall`, `toolResult`, etc.) during migration.

## 9. Backend Changes

### 9.1 `agent-run-manager` (Broker)
Add pending client tool broker keyed by `runId + toolCallId`:
- `requestClientToolAndWait(...)`
- `submitClientToolResult(...)`
- timeout/cancel/reject behavior

Responsibilities:
1. Emit `client_tool_request` event.
2. Store resolver in pending map.
3. Resolve/reject on result arrival.
4. Reject on timeout/run cancellation.

### 9.2 `coordinator/index.ts` (AI SDK)
- Register client tools only when `browserAvailable=true`.
- Client tool implementation delegates to broker wait call.
- Maintain server tools including `coordinator_api_request` as default manager API transport with JSON-safe payload handling (multiline payloads supported).

### 9.3 No-Browser Runs
If `browserAvailable=false`:
- Do not register client/browser tools.
- Planner can only use server tools.
- If forced browser action appears (should not), return tool error immediately (`Browser unavailable`).

## 10. Frontend Changes

### 10.1 Executor
In chat run consumer (`chat-conversation.tsx` path), when event `client_tool_request` arrives:
1. Validate request shape.
2. Find action handler from registry.
3. Validate args via schema.
4. Check `canRun(ctx)`.
5. Execute `run(ctx, args)`.
6. POST `tool-result`.

### 10.2 UI Action Registry Files
Suggested structure:
- `agent-manager-web/src/coordinator-actions/types.ts`
- `agent-manager-web/src/coordinator-actions/registry.ts`
- `agent-manager-web/src/coordinator-actions/actions/*.ts`
- `agent-manager-web/src/coordinator-actions/context.ts`

### 10.3 Failure Reporting
Return structured errors:
- `ACTION_NOT_AVAILABLE`
- `ACTION_VALIDATION_FAILED`
- `ACTION_EXECUTION_FAILED`
- `ACTION_TIMEOUT`

## 11. Run State Model
Run status (conceptual):
- `running`
- `completed`
- `error`

Client-tool phase is represented by pending tool call state in broker; no extra persistent run statuses required unless needed by product UX.

## 12. Scaling / Process Model

### 12.1 Single Process (Phase 1)
Use in-memory run map + pending map. Fastest path and aligns with current architecture.

### 12.2 Multi-Process (Phase 2)
Required additions:
1. Run ownership mechanism (sticky assignment or owner record).
2. Shared broker channel (Redis pub/sub, queue, or DB event bus).
3. Tool result messages routed to owner process.

No design element here requires permanent single-process; shared coordination is the scaling path.

## 13. Security and Guardrails
1. Keep planner/model key server-side for production.
2. Frontend executor should only run registered semantic actions and registered fallback browser tools.
3. Validate all params with strict schemas.
4. Enforce per-action timeout and max consecutive client actions per run.
5. Log every client action request/result with run/tool IDs.
6. Require authenticated user identity on `tool-result` endpoint.

## 14. Observability
Emit logs/metrics for:
- `client_tool.requested`
- `client_tool.resolved`
- `client_tool.rejected`
- `client_tool.timeout`
- latency histograms by action ID
- per-run counts of client vs server tool usage

## 15. Rollout Plan

### Phase 1: Minimal Handshake
- Add broker and `tool-result` endpoint.
- Add core semantic client tools (`ui_get_state`, `ui_list_available_actions`, `ui_run_action`).
- Keep fallback to server tools only.

### Phase 2: Semantic Action Expansion
- Add comprehensive action registry and dynamic `canRun` support.
- Improve structured error handling and retries.

### Phase 2.5: Browser Fallback Tooling
- Add generic browser fallback tools (`ui_browser_*`) for non-semantic interactions.
- Keep semantic-first planner policy and enforce guarded fallback usage.

### Phase 3: Multi-Process Hardening
- Introduce shared broker transport and run ownership.
- Add operational alerts for stuck pending client tools.

## 16. Acceptance Criteria
1. Backend-triggered run without browser completes with server tools only.
2. Frontend-attached run can execute at least one semantic UI action end-to-end.
3. Disconnect/reconnect does not corrupt run state.
4. Client tool timeout surfaces clear model-visible error and run continues/fails deterministically.
5. Audit logs can reconstruct every client tool request/result pair.

## 17. Open Questions
1. Should frontend expose explicit `list_available_actions` as a tool, or only enforce `canRun` during `run_action`?
2. Should client action retries be controlled by backend policy or model reasoning only?
3. Do we persist client action transcripts in DB messages or run-event store only?

## 18. Summary
Implement one backend planner with capability-gated tools, semantic frontend action execution, and a request/result broker for client tools. This supports both browser-attached runs and backend-only runs without branching into separate agent architectures.
