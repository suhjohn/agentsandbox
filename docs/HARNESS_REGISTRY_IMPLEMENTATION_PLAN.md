# Harness Registry Implementation Plan

This checklist tracks the implementation of the harness registry architecture described in `docs/HARNESS_REGISTRY_SPEC.md`.

---

## Phase 1: `agent-manager` Pass-Through

- [x] Change `agent-manager` route schemas to accept `harness?: string` instead of a closed enum.
- [x] Change `agent-manager` service input types to use `harness?: string`.
- [x] Change `agent-manager` service input types to use `modelReasoningEffort?: string`.
- [x] Keep manager behavior pass-through only; do not add harness-specific validation.
- [x] Regenerate `agent-manager/openapi.json`.
- [x] Update `agent-manager/src/services/README.md` to reflect string-based harness inputs.
- [x] Verify manager integration tests that create/start sessions still pass.

## Phase 2: `agent-go` Registry Foundation

- [x] Add `agent-go/internal/harness/registry/` with shared types and registry implementation.
- [x] Define the `Definition` interface for harness execution, defaults, and response metadata.
- [x] Add registry-backed harness lookup helpers in `agent-go/internal/server/serve.go`.
- [x] Update the server struct to store a harness registry instead of direct harness-specific execution branches.
- [x] Remove direct `codex`/`pi` validity checks from session creation and replace them with registry lookup.

## Phase 3: `agent-go` Harness Migration

- [x] Refactor Codex into a harness definition that implements the registry interface.
- [x] Refactor PI into a harness definition that implements the registry interface.
- [x] Move harness-specific model normalization out of central `codex`/`pi` switches and into harness implementations.
- [x] Move harness-specific default model/effect resolution out of central `codex`/`pi` switches and into harness implementations.
- [x] Move harness-specific run response metadata into harness implementations.
- [x] Replace the current execution branch in `serve.go` with registry dispatch.

## Phase 4: `agent-go` Registration Strategy

- [x] Add a single aggregator package that builds the runtime harness registry.
- [x] Decide whether the aggregator is hand-maintained or generated.
- [ ] If generated, add `go generate` support and write the generated aggregator file.
- [x] Keep registration explicit; do not use implicit `init()` registration as the main design.
- [x] Wire startup env/dir setup through the aggregator or a thin initialization layer.

## Phase 5: `agent-go` Contracts and Tests

- [x] Update `agent-go/internal/openapi/openapi.json` for the new harness contract.
- [x] Regenerate `agent-manager-web/src/api/generated/agent.ts`.
- [x] Add or update unit tests for registry behavior.
- [ ] Add or update harness-specific tests for Codex.
- [ ] Add or update harness-specific tests for PI.
- [x] Update session API blackbox tests to cover registry-backed harness validation.
- [x] Update runtime docs in `agent-go/README.md`.
- [x] Update `agent-go/SPECS.md`.

## Phase 6: `agent-manager-web` Registry Foundation

- [x] Add `agent-manager-web/src/harnesses/types.ts`.
- [x] Add `agent-manager-web/src/harnesses/registry.ts`.
- [x] Add a fallback harness definition for unknown harness IDs.
- [x] Load harness modules through `import.meta.glob()` so frontend harness definitions can auto-register.

## Phase 7: `agent-manager-web` Harness Modules

- [x] Add `src/harnesses/codex/index.ts`.
- [x] Add `src/harnesses/pi/index.ts`.
- [x] Move harness-specific model list logic out of `agent-session.tsx` and into harness modules.
- [x] Move harness-specific thinking-level logic out of `agent-session.tsx` and into harness modules.
- [x] Move harness-specific message renderer selection out of `agent-session.tsx` and into harness modules.

## Phase 8: `agent-manager-web` Session UI Refactor

- [x] Refactor `agent-session.tsx` to resolve harness behavior from the registry.
- [x] Stop narrowing session harness to `'codex' | 'pi'` in `agent-session.tsx`.
- [x] Stop defaulting unknown harnesses to `codex`.
- [x] Preserve unknown harness strings in `agent-detail.tsx` config normalization.
- [x] Preserve unknown harness strings when opening sessions from the session list.
- [x] Preserve unknown harness strings when selecting sessions from the session picker.
- [x] Keep the fallback message renderer for unrecognized harnesses.

## Phase 9: Frontend Contracts and Docs

- [x] Regenerate `agent-manager-web/src/api/generated/agent-manager.ts` if manager OpenAPI changes.
- [x] Update `agent-manager-web/src/components/tool.tsx` if tool-call session creation typing should allow arbitrary harness IDs.
- [x] Update `agent-manager-web/src/workspace/README.md` to reflect registry-driven harness behavior.
- [ ] Add tests for harness preservation in `agent-detail`.
- [ ] Add tests for harness lookup behavior in `agent-session`.

## Phase 10: New Harness Trial Run

- [x] Add a sample third harness such as `opencode` in `agent-go/internal/harness/opencode/`.
- [x] Add a matching frontend harness module in `agent-manager-web/src/harnesses/opencode/index.ts`.
- [x] Add a matching message renderer such as `agent-manager-web/src/components/messages/opencode-message.tsx`.
- [x] Confirm that no manager route/service code requires a harness-specific change.
- [x] Confirm that runtime wiring stays localized to harness registration plus harness-specific CLI/container setup.
- [x] Confirm that the only required frontend wiring is the new harness module and renderer.

## Phase 11: Exit Criteria

- [x] `agent-manager` accepts and forwards arbitrary non-empty harness strings.
- [x] `agent-go` has no central `codex` vs `pi` execution switch.
- [x] `agent-manager-web` has no central `codex` vs `pi` UI switch for models, thinking levels, or renderers.
- [x] Unknown harnesses are preserved rather than dropped in panel config.
- [x] A new harness can be added without scattered edits across session UI logic.
