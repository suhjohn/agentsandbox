# COORDINATOR_AGENT_IMPLEMENTATION_PLAN

## 1. Goal
Implement the current coordinator migration described in `docs/COORDINATOR_AGENT_SPEC.md`.

This stage should:
- move coordinator identity onto normal agent rows
- add agent `type` and `visibility`
- use normal agent sessions for coordinator conversations
- converge coordinator dialog and workspace onto the same underlying agent session runtime path

This stage should not yet implement:
- full manager API support inside agent-backed coordinator runs
- coordinator-style frontend UI action support for agent runs

## 2. Deliverables
At the end of this stage, the codebase should have:
1. Agent schema and API support for `type` and `visibility`.
2. A coordinator selection path based on real agents with `type='coordinator'`.
3. Coordinator session lists backed by normal agent sessions.
4. A shared agent-session runtime/view path used by both workspace and coordinator dialog.
5. The old `/coordinator` stack no longer acting as the long-term source of truth for new coordinator flows.

## 3. Constraints
1. Ownership stays on existing `agents.createdBy`.
2. Multiple coordinator agents per user must remain possible.
3. One coordinator agent may have many sessions.
4. The same session may be open in both workspace and dialog.
5. Session visibility should derive from the backing agent for now.

## 4. Workstreams

### 4.1 Schema + Data Model
Files:
- `agent-manager/src/db/schema.ts`
- `agent-manager/drizzle/*`

Tasks:
1. Add `type` column to `agents`.
2. Add `visibility` column to `agents`.
3. Use app-level string semantics:
   - `type`: `worker | coordinator`
   - `visibility`: `private | shared`
4. Backfill existing rows:
   - `type='worker'`
   - `visibility='private'`
5. Add indexes if needed for common filtering patterns:
   - `agents.type`
   - `agents.visibility`
   - optionally compound indexes if listing performance needs them

Acceptance:
1. Existing agent rows migrate cleanly.
2. New rows always get stable defaults.
3. Schema and generated migration metadata are consistent.

### 4.2 Backend Agent Model + APIs
Files:
- `agent-manager/src/services/agent.service.ts`
- `agent-manager/src/routes/agents.ts`
- `agent-manager/src/routes/session.ts`
- `agent-manager-web/src/lib/api.ts`

Tasks:
1. Extend backend agent types and public payloads to include:
   - `type`
   - `visibility`
2. Extend create/update/list paths to validate and expose those fields where appropriate.
3. Add list filters for:
   - `type`
   - `visibility`
4. Ensure session listing/filtering can derive sharing semantics from the joined agent.
5. Keep backward-compatible defaults for older callers during migration.

Acceptance:
1. Agent list APIs can filter by `type` and `visibility`.
2. Frontend API client types expose those fields everywhere agents are surfaced.
3. Session list routes can support coordinator-session UX through normal agent session filtering.

### 4.3 Coordinator Resolution
Files:
- likely coordinator selection code in frontend routes/components
- current coordinator dialog files

Tasks:
1. Define a simple selection strategy for coordinator agents for this stage.
2. Initial recommendation:
   - list current user's agents filtered by `type='coordinator'`
   - choose current selection in app/UI state
3. Avoid introducing a hard-coded one-agent-per-user assumption.
4. Keep room for future enhancements:
   - default coordinator
   - labels
   - favorites

Acceptance:
1. A user with multiple coordinator agents can choose among them.
2. No schema-level one-to-one coordinator binding is required in this stage.

### 4.4 Session Source Of Truth Migration
Files:
- `agent-manager-web/src/components/coordinator-session-dialog.tsx`
- `agent-manager-web/src/routes/chat-conversation.tsx`
- `agent-manager-web/src/workspace/panels/agent-session.tsx`
- session-related backend/frontend API usage

Tasks:
1. Stop treating coordinator-specific sessions as the primary path for new coordinator UX.
2. Switch coordinator session listing to normal agent sessions for the selected coordinator agent.
3. Ensure create/open/select actions operate on normal agent sessions.
4. Keep temporary compatibility shims only if needed during cutover.

Acceptance:
1. Opening coordinator conversation creates or loads a normal agent session.
2. Session history is no longer split between coordinator sessions and agent sessions for the new flow.

### 4.5 Shared Session Runtime/View Extraction
Files:
- `agent-manager-web/src/workspace/panels/agent-session.tsx`
- `agent-manager-web/src/components/coordinator-session-dialog.tsx`
- any new shared session view module

Tasks:
1. Identify the reusable core inside `agent-session.tsx`:
   - runtime access loading
   - session fetch/load
   - stream subscription
   - composer/send/stop logic
   - message rendering
2. Extract shared logic into reusable building blocks.
3. Keep workspace-specific chrome separate from the reusable core.
4. Make coordinator dialog consume the same runtime/session path as workspace.

Preferred shape:
1. Shared session runtime hook or controller.
2. Shared session conversation view component.
3. Thin wrappers for:
   - workspace panel
   - coordinator dialog

Acceptance:
1. Workspace and dialog do not maintain two separate streaming implementations.
2. The same session can render correctly in both surfaces.
3. Shared stream connection logic remains de-duplicated.

### 4.6 Shared Session Concurrency
Files:
- `agent-manager-web/src/workspace/panels/agent-session.tsx`
- extracted shared runtime modules

Tasks:
1. Preserve shared connection behavior keyed by session identity.
2. Ensure two mounts of the same session do not create conflicting stream ownership.
3. Verify send/stop/update behavior when:
   - dialog and workspace are both open
   - one closes while the other remains
   - a stream ends while both are mounted

Acceptance:
1. Same session open in dialog and workspace remains consistent.
2. No duplicated SSE subscriptions or conflicting stop behavior beyond intended semantics.

### 4.7 Coordinator Dialog Refactor
Files:
- `agent-manager-web/src/components/coordinator-session-dialog.tsx`
- `agent-manager-web/src/routes/root.tsx`
- supporting selection/session list UI

Tasks:
1. Change the dialog from a coordinator-specific conversation shell into:
   - coordinator-agent selector
   - normal agent session selector
   - shared agent-session runtime host
2. Remove assumptions that the dialog is backed by `coordinatorSessionId`.
3. Replace with selected:
   - `agentId`
   - `sessionId`
4. Preserve existing open/close/global shortcut behavior in `root.tsx`.

Acceptance:
1. Dialog still behaves like “Coordinator” to the user.
2. Internally it runs on real agent/session state.

### 4.8 Workspace Integration
Files:
- `agent-manager-web/src/workspace/panels/coordinator.tsx`
- `agent-manager-web/src/workspace/panels/agent-detail.tsx`
- `agent-manager-web/src/workspace/ui/workspace-view.tsx`

Tasks:
1. Update workspace coordinator panel to use coordinator-type agents and normal agent sessions.
2. Ensure “open in workspace” and “open in dialog” flows can target the same session.
3. Avoid maintaining separate coordinator-only message/rendering logic in workspace.

Acceptance:
1. Workspace and dialog coordinator entrypoints resolve to the same session model.
2. Session opening behavior is deterministic and reusable.

### 4.9 Legacy Coordinator Path Handling
Files:
- `agent-manager/src/routes/coordinator.ts`
- `agent-manager/src/services/coordinator-session.service.ts`
- `agent-manager/src/coordinator/*`
- old coordinator frontend files

Tasks:
1. Decide whether the old coordinator stack remains temporarily for compatibility.
2. If it remains:
   - mark it as transitional
   - stop extending it for new behavior
3. If safe to do so:
   - remove coordinator-specific session usage from new UI paths first
   - defer full deletion until next-stage capabilities are ready

Acceptance:
1. Team has a clear boundary between transitional code and target architecture.
2. New work stops accruing on the legacy coordinator stack.

## 5. Recommended Sequencing

### Phase 1: Data Model
1. Add `agents.type` and `agents.visibility`.
2. Backfill defaults.
3. Expose fields through backend and frontend API types.

### Phase 2: Listing + Selection
1. Add agent list filters for `type` and `visibility`.
2. Add coordinator-agent selection path in UI.
3. Define how the selected coordinator agent is held in app state.

### Phase 3: Session Model Convergence
1. Switch coordinator session lists to normal agent sessions.
2. Replace coordinator-session creation/open logic with agent-session creation/open logic.

### Phase 4: Shared Session UI Runtime
1. Extract shared runtime/view logic from `agent-session.tsx`.
2. Mount the shared runtime in workspace and dialog.
3. Validate same-session dual-open behavior.

### Phase 5: Cleanup
1. Remove or quarantine old coordinator-specific session flows from primary UI.
2. Update docs and tests.
3. Prepare next-stage task for manager API + UI actions.

## 6. Testing Plan

### 6.1 Backend
1. Migration test for `agents.type` and `agents.visibility`.
2. Route/service tests for agent filtering by:
   - `type`
   - `visibility`
3. Session listing tests to confirm agent-derived sharing semantics.

### 6.2 Frontend
1. Coordinator dialog can load coordinator agents.
2. Coordinator dialog can list/open/create normal agent sessions.
3. Workspace and dialog can render the same session.
4. Shared session stream state remains coherent across both surfaces.

### 6.3 Manual Scenarios
1. User with one coordinator agent.
2. User with multiple coordinator agents.
3. Shared coordinator visible to another user.
4. Same session open in workspace and dialog simultaneously.
5. Stream in progress while one surface is closed.

## 7. Risks
1. `agent-session.tsx` may currently contain too much panel-specific logic to reuse directly.
2. Existing coordinator UI shortcuts/actions may be coupled to coordinator-specific IDs and flows.
3. Session listing semantics may require additional joins or API adjustments for good UX.
4. Legacy coordinator routes may linger and create confusion if not clearly treated as transitional.

## 8. Open Decisions
1. Where should selected coordinator agent state live?
   - dialog-local only
   - persisted per user
   - route/search state
2. Should shared coordinators be writable by all viewers or only openable?
3. Do we need a dedicated “coordinator picker” UI immediately, or is a simple default selection enough for first pass?
4. When should the legacy `/coordinator` stack be fully deleted?

## 9. Exit Criteria
This implementation stage is complete when:
1. Coordinator is backed by real agents with `type='coordinator'`.
2. Agent visibility supports `private` and `shared`.
3. Coordinator dialog uses normal agent sessions.
4. Workspace and dialog share the same agent session runtime path.
5. The legacy coordinator-specific session model is no longer required for the main user flow.

## 10. Follow-Up Stage
The next stage should cover:
1. Full manager API support inside agent-backed coordinator runs.
2. Coordinator-style semantic UI action support.
3. Porting the current client-tool request/result handshake onto agent runs.
