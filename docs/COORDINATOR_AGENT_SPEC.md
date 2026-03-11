# COORDINATOR_AGENT_SPEC

## 1. Purpose
Define the next coordinator architecture as a thin product concept on top of the existing agent system.

The main idea is:
- a coordinator is a real agent row
- coordinator conversations are normal agent sessions
- the coordinator dialog and workspace should reuse the same underlying agent session runtime

This stage does not require full manager API tool parity or coordinator-style frontend UI action execution. Those are explicitly deferred to the next stage.

## 2. Product Direction

### 2.1 Core Principle
Coordinator should stop being a separate backend conversation/runtime stack.

Instead:
- agent type determines whether an agent is a normal worker or a coordinator
- coordinator UI is a specialized entrypoint into a coordinator-type agent
- coordinator history is stored in normal agent sessions

### 2.2 Why
Today there are effectively two parallel systems:
- coordinator chat and persistence
- agent runtime sessions and persistence

That split creates duplicated concepts, duplicated UI, and unnecessary migration work later. The goal of this stage is to collapse those paths into one shared model.

## 3. Scope Of This Stage
This stage includes:
1. Treat coordinator as a real agent.
2. Add agent metadata for coordinator classification and sharing semantics.
3. Use normal agent sessions for coordinator conversations.
4. Reuse the same session/runtime UI path in both workspace and coordinator dialog.
5. Allow the same agent session to be open in both workspace and dialog.

This stage does not include:
1. Full manager API support inside the agent runtime.
2. Coordinator-style semantic UI actions.
3. Porting the current client tool request/result protocol onto agent runs.

Those are next-stage requirements.

## 4. Explicit Decisions

### 4.1 Agent Type
Agents gain an app-level `type` field with these intended values:
- `worker`
- `coordinator`

This does not need to be DB-enum constrained. Validation should happen in route/service/app code.

### 4.2 Agent Visibility
Agents gain an app-level `visibility` field with these intended values:
- `private`
- `shared`

This is needed for shared/private semantics in agents list and session list views.

### 4.3 Ownership
Ownership continues to use the existing `createdBy` field on agents.

We are not adding `ownerId`.

### 4.4 Multiple Coordinators Per User
A user may have multiple coordinator agents.

We do not want to hard-code a single coordinator per user at the data-model level.

### 4.5 Session Model
Coordinator uses:
- one coordinator agent
- many sessions under that agent

Coordinator does not use a separate session table or conversation model.

### 4.6 Shared Session Presence
The same agent session may be open in both:
- the workspace
- the coordinator dialog

The runtime/session path must tolerate this cleanly.

## 5. Data Model

### 5.1 Agent Fields
Relevant target fields on `agents` in `agent-manager/src/db/schema.ts`:
- existing: `createdBy`
- new: `type`
- new: `visibility`

Intended meanings:
- `type='worker'`: normal task agent
- `type='coordinator'`: agent is eligible to back coordinator UX
- `visibility='private'`: only owner can see/use it
- `visibility='shared'`: other users may see/use it according to product rules

### 5.2 Session Visibility Semantics
For this stage, session visibility should be derived from the owning agent.

We are not introducing a separate session visibility field in this stage unless implementation pressure proves it necessary.

## 6. Coordinator Resolution

### 6.1 What Coordinator Means
Coordinator is no longer a separate runtime identity. It is:
- a selected agent
- where `agent.type === 'coordinator'`

### 6.2 Selection
This spec intentionally does not require a permanent one-to-one user->coordinator binding.

Acceptable immediate behavior:
- pick a selected coordinator agent in UI/app logic
- support multiple coordinator agents per user

Future enhancements like defaults, favorites, or labels can be added later without changing this core model.

## 7. Session Architecture

### 7.1 Replace Coordinator Sessions
The current coordinator-specific conversation/session path should be phased out as the primary source of truth.

Coordinator conversations should instead use normal agent sessions:
- create/fetch sessions from existing agent/session APIs
- render messages from the agent runtime session path
- stream runs from the agent runtime session path

### 7.2 One Shared Runtime Path
The coordinator dialog should use the same underlying session/runtime behavior as:
- `agent-manager-web/src/workspace/panels/agent-session.tsx`

This does not necessarily mean mounting that file unchanged inside the dialog. The preferred outcome is:
- extract a shared session/runtime view core
- reuse it in both workspace and dialog wrappers

### 7.3 Concurrency Expectation
If the same session is open in both workspace and dialog:
- both should observe the same underlying session stream state
- duplicate transport logic should be avoided
- shared stream connection logic should remain the source of truth

## 8. UI Behavior

### 8.1 Coordinator Dialog
The coordinator dialog should become:
- a selector/host for coordinator-type agents and their sessions
- not a separate coordinator-only conversation system

### 8.2 Workspace
Workspace remains able to open the same agent session in:
- normal agent detail/session views
- coordinator entry flows if desired

### 8.3 Session Lists
Coordinator session lists should become agent session lists filtered by the selected coordinator agent.

This aligns the dialog with the rest of the product instead of maintaining a special session table.

## 9. List View Semantics

### 9.1 Agents List
Agents list view should support filtering and display using:
- `type`
- `visibility`
- `createdBy`
- existing archive/status behavior

### 9.2 Sessions List
Sessions list view should respect the selected agent and that agent's visibility semantics.

At this stage:
- session accessibility can be derived from the backing agent
- no separate coordinator-session visibility model is needed

## 10. Backend Direction For This Stage
This stage should favor reuse of the existing agent and session backend paths.

Primary direction:
1. Reuse real agent rows.
2. Reuse normal agent sessions.
3. Reuse existing runtime access and streaming model already used by agent session UI.

Compatibility note:
- the existing `/coordinator` stack may temporarily remain during migration
- but it should no longer define the long-term architecture

## 11. Frontend Direction For This Stage
Frontend should converge toward one shared agent-session UI/runtime implementation.

Preferred direction:
1. Identify the reusable runtime/session core from `agent-manager-web/src/workspace/panels/agent-session.tsx`.
2. Extract shared logic where necessary.
3. Make coordinator dialog consume that same runtime/session path.

The goal is not to preserve `ChatConversationPage` as a separate long-term coordinator engine.

## 12. Deferred To Next Stage
The following are intentionally not part of this stage:

### 12.1 Full Manager API Support
In the next stage, coordinator-backed agents should be able to use full manager API support in a first-class way.

### 12.2 Coordinator-Style UI Actions
In the next stage, coordinator-backed agents should also gain coordinator-style UI action support, including the same general loop used by the current coordinator architecture:
1. backend run emits a client tool request
2. frontend executes semantic UI action or guarded fallback
3. frontend submits tool result
4. run resumes

### 12.3 Protocol Port
The current coordinator client-tool handshake should be treated as a future porting target for agent runs, not a requirement for this migration step.

## 13. Migration Outcome
This stage is successful when:
1. Coordinator is represented by normal agents with `type='coordinator'`.
2. Coordinator conversations are normal agent sessions.
3. The coordinator dialog and workspace use the same underlying agent session runtime path.
4. A session can be viewed from both dialog and workspace without introducing a second conversation model.
5. List views can express `private` vs `shared` coordinator semantics using agent visibility.

## 14. Non-Goals
This stage is not trying to:
1. Finish the full coordinator capability story.
2. Preserve the current coordinator backend as the long-term architecture.
3. Add a second ownership field to agents.
4. Add session-level visibility unless it becomes necessary.

## 15. Summary
Coordinator should become a role of an agent, not a separate system.

For this stage:
- agents gain `type` and `visibility`
- coordinator uses normal agent sessions
- coordinator dialog reuses the same agent session runtime path as workspace

For the next stage:
- add full manager API support
- add coordinator-style UI action support
- port the client tool handshake onto agent-backed runs
