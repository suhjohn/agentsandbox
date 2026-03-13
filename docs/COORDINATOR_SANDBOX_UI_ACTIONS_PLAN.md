# COORDINATOR_SANDBOX_UI_ACTIONS_PLAN

## 1. Purpose

This document records the current coordinator UI-action architecture, the target direction for the sandbox-resident coordinator, and the implementation approaches available to us now.

The immediate goal is to support UI-oriented coordinator capabilities from the coordinator agent sandbox that is seeded from:

- `agent-manager/scripts/ensure-default-coordinator-image.ts`
- `agent-manager/seeds/coordinator/AGENTS.md`
- `agent-manager/seeds/coordinator/tools/*`

The intended first step is to add sandbox-resident tool implementations under:

- `agent-manager/seeds/coordinator/tools/ui-actions/*`

This document is intentionally explicit about what exists today, what is legacy, what is deprecated-but-still-present, and what we actually want to ship next.

## 2. Executive Summary

### 2.1 Status Quo

Today there are two different coordinator-related concepts in the repo:

1. The current coordinator agent image and sandbox path.
2. The legacy manager-side `/coordinator` run stack.

The coordinator image path is already used to seed and create real coordinator agents. The migration docs already establish that coordinator identity now lives on normal agents and that coordinator conversations should converge onto normal agent sessions.

Separately, the old manager-side coordinator stack still contains a browser-attached client tool protocol:

- backend creates tool definitions in `agent-manager/src/coordinator/index.ts`
- backend emits `client_tool_request`
- frontend executes browser or semantic UI actions in the live web app
- frontend posts results back to the backend

That old path is deprecated and should not be the long-term implementation source for sandbox-resident coordinator UI support.

### 2.2 What We Want

We want the coordinator agent that is spun up from the default coordinator image to have its own discoverable UI tools inside the sandbox.

Concretely:

1. Seed tool implementations into the coordinator sandbox via `agent-manager/seeds/coordinator/tools/ui-actions/*`.
2. Teach the coordinator via seeded `AGENTS.md` when and how to use those tools.
3. Start with direct sandbox-resident UI tooling rather than reviving the legacy manager-side `clientTools` request/result loop.

### 2.3 First Practical Step

The first practical step should be:

1. Implement sandbox-resident Bun/TypeScript UI browser tools under `agent-manager/seeds/coordinator/tools/ui-actions/*`.
2. Update `agent-manager/seeds/coordinator/AGENTS.md` to instruct the coordinator to use them.
3. Continue treating the old manager-side `/coordinator` `clientTools` machinery as reference material only.

## 3. Current Architecture

### 3.1 Coordinator Agent Image Seeding

The script `agent-manager/scripts/ensure-default-coordinator-image.ts` is responsible for:

1. Ensuring there is a global default coordinator image record.
2. Setting `globalSettings.defaultCoordinatorImageId`.
3. Syncing the coordinator seed volume.

The coordinator seed volume sync currently does two things:

1. Renders and writes `/AGENTS.md` into the seeded coordinator image volume.
2. Copies every file under `agent-manager/seeds/coordinator/tools` into `/tools/...` in that image volume.

That means the coordinator sandbox gets both:

- prompt/instruction material
- tool files and READMEs

This is the core reason `agent-manager/seeds/coordinator/tools/ui-actions/*` is the right implementation location.

### 3.2 Seeded Coordinator Prompt

The seeded coordinator prompt lives at:

- `agent-manager/seeds/coordinator/AGENTS.md`

This prompt is the coordinator's instruction surface. It tells the coordinator:

1. what tools exist
2. which tools to prefer
3. how to choose between manager API calls, shell commands, runtime access, and UI-oriented operations

Right now that file still contains legacy language for browser-attached client tools and semantic UI actions. It treats these tools as if they are available through the old manager-side loop.

That is no longer the architecture we want to extend.

### 3.3 Existing Seeded Coordinator Tools

Today the seeded tool tree already includes at least:

- `agent-manager/seeds/coordinator/tools/agent-manager-tools/README.md`

This shows the intended pattern:

1. tools live under the seeded coordinator tools directory
2. tools are documented for in-sandbox use
3. the coordinator can discover and use them from its own sandbox

The proposed `ui-actions/*` tools should follow the same pattern.

### 3.4 Legacy Manager-Side Coordinator UI Tool Protocol

The old manager-side UI tool protocol is implemented by these pieces:

- `agent-manager/src/coordinator/index.ts`
- `agent-manager/src/services/agent-run-manager.ts`
- `agent-manager/src/routes/coordinator.ts`
- `agent-manager-web/src/routes/chat-conversation.tsx`
- `agent-manager-web/src/coordinator-actions/executor.ts`
- `agent-manager-web/src/coordinator-actions/browser-tools.ts`
- `agent-manager-web/src/ui-actions/*`

In that legacy model:

1. The backend defines tools like `ui_run_action`, `ui_get_state`, `ui_browser_navigate`, and friends.
2. Those backend tools do not execute UI behavior directly.
3. Instead, they call `clientTools.requestClientTool(...)`.
4. `agent-run-manager` emits a `client_tool_request` event into the run stream.
5. The live browser tab receives that request.
6. The frontend executes the request locally:
   - semantic UI actions via `agent-manager-web/src/ui-actions/*`
   - raw browser fallback actions via `agent-manager-web/src/coordinator-actions/browser-tools.ts`
7. The frontend posts the result back to `/coordinator/runs/:runId/tool-result`.
8. The backend resolves the pending tool call and resumes the run.

This old protocol is important as reference material because it shows:

1. the old tool names
2. the old result envelope shape
3. the distinction between semantic UI actions and raw browser actions

But it is not the architecture we want to build on for sandbox-resident coordinator UI support.

## 4. What `clientTools` Actually Did In The Legacy Model

### 4.1 Role Of `clientTools`

`clientTools` in `agent-manager/src/coordinator/index.ts` was the bridge between a manager-side run and a live browser-attached frontend.

It had everything to do with connecting to the UI in the legacy system.

It did not:

1. make tools available inside the sandbox
2. run browser actions inside the sandbox
3. expose coordinator UI tools as local scripts or modules inside the coordinator agent

Instead, it delegated execution to the frontend.

### 4.2 Why That Matters

This distinction matters because if we now want the coordinator agent sandbox itself to leverage UI tools, then `clientTools` is not the mechanism to extend unless we explicitly recreate a relay protocol.

For the new architecture:

- direct sandbox-resident tools should execute from the sandbox
- the old manager-side browser-attached `clientTools` loop should not be the default implementation path

### 4.3 What We Still Want To Preserve From It

Even though we do not want to continue the old architecture, we still want to preserve several ideas from it:

1. Stable tool names for UI capabilities.
2. Clear distinction between semantic UI actions and raw browser fallback tools.
3. Good result envelopes and explicit error reporting.
4. Prompt guidance that tells the coordinator when to prefer one approach over another.

## 5. Current Meaning Of "Connect To The UI"

There are two different meanings of "connect to the UI", and the document keeps them separate.

### 5.1 Legacy Meaning

In the legacy manager-side model, "connect to the UI" meant:

1. the coordinator run happens in manager backend code
2. the frontend browser is attached to that run
3. the frontend executes UI requests locally

This was not sandbox-driven.

### 5.2 New Meaning

In the new sandbox-resident coordinator model, "connect to the UI" means:

1. the coordinator runs inside the sandbox agent
2. the coordinator has its own tool implementations in the sandbox
3. those tools interact with the UI directly from the sandbox

This can be done by:

1. browser automation from the sandbox
2. network calls from the sandbox to app/backend endpoints
3. a future optional semantic-action bridge if we decide to add one

The important point is that the sandbox-resident coordinator should not need the old manager-side `clientTools` loop just to gain first-pass UI capabilities.

## 6. Target Direction

### 6.1 Product Direction

The target direction is:

1. coordinator lives on the sandbox agent
2. seeded coordinator tools live with that agent
3. UI capabilities should be discoverable and executable from inside the sandbox agent
4. the default coordinator image should continue to be the provisioning point for those capabilities

### 6.2 Tool Placement

The intended tool implementation location is:

- `agent-manager/seeds/coordinator/tools/ui-actions/*`

This works well because `ensure-default-coordinator-image.ts` already syncs everything under the seeded `tools` directory into the coordinator image volume.

### 6.3 Discovery Path

The coordinator will know these tools should be used because:

1. the tool files will exist in `/tools/ui-actions/*` in the sandbox
2. their README and module layout can make them discoverable as concrete utilities
3. seeded `AGENTS.md` can explicitly instruct the coordinator when to use them

The instruction layer is as important as the implementation layer. A tool that exists on disk but is not named and prioritized in `AGENTS.md` will be discovered less reliably.

## 7. Tool Families

### 7.1 Family A: Direct Browser-Oriented Tools

These are the most natural first step for sandbox-resident implementation:

- `ui_browser_navigate`
- `ui_browser_snapshot`
- `ui_browser_click`
- `ui_browser_type`
- `ui_browser_wait`
- `ui_browser_scroll`
- `ui_browser_eval`

These are good first candidates because they map naturally to sandbox-local browser automation.

They do not require:

1. frontend runtime controller access
2. in-browser React action registries
3. the legacy `clientTools` request/result loop

They can be implemented as Bun/TypeScript scripts or modules that control the coordinator sandbox's browser stack directly.

### 7.2 Family B: Semantic UI Tools

These are the harder tools:

- `ui_get_state`
- `ui_list_available_actions`
- `ui_run_action`

In the old model, these had special meaning because they were backed by live frontend runtime state and semantic action execution.

For the sandbox-resident coordinator, these names are only valid if we define exactly what they mean now.

We have three possible meanings:

1. Browser-derived approximations.
2. A static sandbox-local action abstraction layer.
3. A future explicit bridge back into live frontend semantics.

Until that decision is explicit, we should not claim these tools provide the same guarantees as the old browser-attached semantic action path.

## 8. Desired First Implementation

### 8.1 Immediate Goal

Try direct sandbox-resident UI tooling first.

That means:

1. do not port the old `clientTools` relay protocol first
2. do not revive manager-side `/coordinator` UI execution
3. start by giving the coordinator agent local tools it can call itself

### 8.2 Why This Is The Right First Step

This approach is:

1. simpler
2. aligned with the current coordinator residency model
3. easier to seed and ship through the default coordinator image
4. easier to reason about operationally
5. less coupled to deprecated manager-side coordinator code

### 8.3 Preferred Runtime

The preferred implementation runtime for these tools is:

- TypeScript executed with Bun

Reasons:

1. the repo already uses Bun heavily
2. the old client tool contracts are already expressed in TypeScript
3. future shared types or schemas are easier to reuse from TypeScript than from Python
4. a Bun tool bundle will match the rest of the coordinator toolchain better than a Python reimplementation for UI-specific abstractions

## 9. Approaches

### 9.1 Approach 1: Direct Sandbox Browser Tools

This is the recommended first approach.

#### Description

Implement the `ui_browser_*` family as Bun/TypeScript tools inside:

- `agent-manager/seeds/coordinator/tools/ui-actions/*`

These tools run in the coordinator sandbox and directly automate the UI from there.

#### Pros

1. Matches the current coordinator residency model.
2. Avoids legacy manager-side coordinator plumbing.
3. Easy to seed into the coordinator image.
4. Lowest implementation complexity.
5. Good enough for navigation, clicking, typing, waiting, snapshots, and DOM inspection.

#### Cons

1. Does not automatically preserve old semantic UI guarantees.
2. `ui_get_state`, `ui_list_available_actions`, and `ui_run_action` need deliberate new semantics.
3. Browser-derived state may be less precise than frontend semantic snapshots.

#### Recommended Scope

Implement first:

1. `ui_browser_navigate`
2. `ui_browser_snapshot`
3. `ui_browser_click`
4. `ui_browser_type`
5. `ui_browser_wait`
6. `ui_browser_scroll`
7. `ui_browser_eval`

Then decide how to layer semantic helpers on top.

### 9.2 Approach 2: Sandbox-Local Semantic Wrapper Layer

This is a possible second step after direct browser tools exist.

#### Description

Define a small sandbox-local semantic layer:

1. `ui_get_state` returns a structured browser-derived state object
2. `ui_list_available_actions` returns a manifest of action IDs supported by the sandbox
3. `ui_run_action` maps action IDs to scripted browser flows

This does not attempt to reuse frontend runtime controllers. Instead it provides a coordinator-friendly abstraction layer over the browser tools.

#### Pros

1. Keeps the old mental model of semantic actions.
2. Lets the coordinator ask for action-oriented behavior instead of raw DOM actions.
3. Still stays sandbox-resident.

#### Cons

1. Semantics will diverge from the legacy frontend semantic action system unless carefully maintained.
2. Action coverage will need explicit curation.
3. Browser-derived state may be weaker than true app semantic state.

#### When To Use

Use this after direct browser tools exist and only for actions that clearly benefit from a named abstraction.

### 9.3 Approach 3: Rebuild A Browser-Attached Semantic Bridge

This is the closest to the legacy model, but it should not be the first step.

#### Description

Create a new bridge so the sandbox-resident coordinator can ask the live frontend to execute semantic UI actions, similar to the old `clientTools` model.

That would require:

1. frontend registration/attachment
2. a request/response protocol
3. manager or app relay endpoints
4. a result-return path

#### Pros

1. Preserves true frontend semantic action behavior.
2. Reuses existing semantic action code in `agent-manager-web`.
3. Keeps exact app-side meaning for `ui_get_state`, `ui_list_available_actions`, and `ui_run_action`.

#### Cons

1. Highest complexity.
2. Reintroduces a request/response bridge similar to legacy `clientTools`.
3. Adds more moving parts and attachment-state handling.
4. Not aligned with the desire to try direct sandbox tooling first.

#### Recommendation

Defer this unless direct sandbox tools prove insufficient.

## 10. Recommended Plan

### Phase 1: Document And Seed The New Tool Family

1. Create `agent-manager/seeds/coordinator/tools/ui-actions/README.md`.
2. Add clear usage examples for Bun-executed tools.
3. Update `agent-manager/seeds/coordinator/AGENTS.md`:
   - prefer `ui_browser_*` tools for direct UI work
   - explain `ui_get_state` only if implemented
   - explain that semantic action guarantees are not inherited from legacy code unless explicitly recreated

### Phase 2: Implement Direct Browser Tools

Add Bun/TS implementations for:

1. `ui_browser_navigate`
2. `ui_browser_snapshot`
3. `ui_browser_click`
4. `ui_browser_type`
5. `ui_browser_wait`
6. `ui_browser_scroll`
7. `ui_browser_eval`

These should be thin, deterministic, and CLI-friendly.

### Phase 3: Decide Semantic Layer Strategy

After direct browser tools work, decide whether to:

1. stop there
2. add browser-derived semantic wrappers
3. build a new frontend semantic bridge

### Phase 4: Only Then Revisit Legacy Semantics

If needed later:

1. define exact guarantees for `ui_get_state`
2. define exact supported action catalog for `ui_list_available_actions`
3. define exact action execution semantics for `ui_run_action`

Do not pretend these are legacy-equivalent until that work actually exists.

## 11. What We Should Change In `AGENTS.md`

The seeded coordinator prompt should be updated to reflect the new architecture.

### 11.1 What Is Wrong With The Current Prompt

The current prompt still frames UI tools as browser-attached client tools and references the old semantic execution loop.

That is misleading for the sandbox-resident coordinator path.

### 11.2 What The Prompt Should Say Instead

The prompt should explicitly say:

1. UI browser tools live in the coordinator sandbox under `/tools/ui-actions/*`.
2. These tools should be used directly for UI work.
3. `ui_browser_*` are the primary UI operation tools.
4. Semantic `ui_*` tools only exist if implemented in the sandbox tool bundle.
5. Legacy manager-side `clientTools` are not the current execution path for sandbox-resident coordinator behavior.

### 11.3 Why Prompt Changes Matter

The coordinator will not reliably use the new tools just because files exist in the sandbox.

It also needs:

1. naming guidance
2. selection guidance
3. preference guidance
4. examples

The seeded `AGENTS.md` is where that guidance belongs.

## 12. Proposed Tool Tree

Recommended initial structure:

```text
agent-manager/seeds/coordinator/tools/ui-actions/
  README.md
  package.json
  tsconfig.json
  _shared/
    browser.ts
    cli.ts
    output.ts
    selectors.ts
  ui_browser_navigate.ts
  ui_browser_snapshot.ts
  ui_browser_click.ts
  ui_browser_type.ts
  ui_browser_wait.ts
  ui_browser_scroll.ts
  ui_browser_eval.ts
```

Optional later additions:

```text
  ui_get_state.ts
  ui_list_available_actions.ts
  ui_run_action.ts
  actions/
    index.ts
    nav.go.ts
    workspace.panel.open.ts
    chat.send_message.ts
```

## 13. Non-Goals For The First Step

The following are intentionally out of scope for the first implementation:

1. Porting the old `/coordinator` client tool protocol onto agent-backed coordinator runs.
2. Reusing frontend runtime controllers directly from the sandbox.
3. Claiming semantic equivalence with `agent-manager-web/src/ui-actions/*`.
4. Building a full frontend-attachment state machine before validating direct browser tools.

## 14. Risks

### 14.1 Naming Risk

If we use the old semantic names without clarifying their new meaning, we may create confusion between:

1. browser-driven approximations
2. true semantic frontend actions

### 14.2 Prompt Drift Risk

If we add tools under `seeds/coordinator/tools/ui-actions/*` but do not update seeded `AGENTS.md`, the coordinator may not discover or prioritize them consistently.

### 14.3 Dual-Architecture Confusion

As long as `agent-manager/src/coordinator/index.ts` still exists, it is easy to confuse:

1. deprecated manager-side coordinator UI tooling
2. new sandbox-resident coordinator UI tooling

The new docs and prompt must explicitly call this out.

## 15. Recommended Decision

The recommended decision is:

1. Keep `agent-manager/src/coordinator/index.ts` as deprecated reference material only.
2. Implement direct Bun/TS UI browser tools under `agent-manager/seeds/coordinator/tools/ui-actions/*`.
3. Update `agent-manager/seeds/coordinator/AGENTS.md` so the coordinator knows to use those tools.
4. Treat `ui_browser_*` as the first real tool family.
5. Defer true semantic `ui_*` parity until we decide whether to build a sandbox-local semantic wrapper layer or a new frontend semantic bridge.

## 16. Concrete Next Steps

1. Create `agent-manager/seeds/coordinator/tools/ui-actions/README.md`.
2. Add Bun/TS shared helpers and at least one working browser tool.
3. Update seeded `AGENTS.md` to mention `/tools/ui-actions/*` explicitly.
4. Remove or rewrite stale prompt language that implies browser-attached client tool execution through the old manager-side `clientTools` loop.
5. Add direct browser tools incrementally until the coordinator can reliably inspect and manipulate the UI from the sandbox.
