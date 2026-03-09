# Harness Registry Implementation Plan

This checklist tracks the implementation of the harness registry architecture described in `docs/HARNESS_REGISTRY_SPEC.md`.

---

## Phase 1: `agent-manager` Pass-Through

- [ ] Change `agent-manager` route schemas to accept `harness?: string` instead of a closed enum.
- [ ] Change `agent-manager` service input types to use `harness?: string`.
- [ ] Change `agent-manager` service input types to use `modelReasoningEffort?: string`.
- [ ] Keep manager behavior pass-through only; do not add harness-specific validation.
- [ ] Regenerate `agent-manager/openapi.json`.
- [ ] Update `agent-manager/src/services/README.md` to reflect string-based harness inputs.
- [ ] Verify manager integration tests that create/start sessions still pass.

## Phase 2: `agent-go` Registry Foundation

- [ ] Add `agent-go/internal/harness/registry/` with shared types and registry implementation.
- [ ] Define the `Definition` interface for harness execution, defaults, and response metadata.
- [ ] Add registry-backed harness lookup helpers in `agent-go/internal/server/serve.go`.
- [ ] Update the server struct to store a harness registry instead of direct harness-specific execution branches.
- [ ] Remove direct `codex`/`pi` validity checks from session creation and replace them with registry lookup.

## Phase 3: `agent-go` Harness Migration

- [ ] Refactor Codex into a harness definition that implements the registry interface.
- [ ] Refactor PI into a harness definition that implements the registry interface.
- [ ] Move harness-specific model normalization out of central `codex`/`pi` switches and into harness implementations.
- [ ] Move harness-specific default model/effect resolution out of central `codex`/`pi` switches and into harness implementations.
- [ ] Move harness-specific run response metadata into harness implementations.
- [ ] Replace the current execution branch in `serve.go` with registry dispatch.

## Phase 4: `agent-go` Registration Strategy

- [ ] Add a single aggregator package that builds the runtime harness registry.
- [ ] Decide whether the aggregator is hand-maintained or generated.
- [ ] If generated, add `go generate` support and write the generated aggregator file.
- [ ] Keep registration explicit; do not use implicit `init()` registration as the main design.
- [ ] Wire startup env/dir setup through the aggregator or a thin initialization layer.

## Phase 5: `agent-go` Contracts and Tests

- [ ] Update `agent-go/internal/openapi/openapi.json` for the new harness contract.
- [ ] Regenerate `agent-manager-web/src/api/generated/agent.ts`.
- [ ] Add or update unit tests for registry behavior.
- [ ] Add or update harness-specific tests for Codex.
- [ ] Add or update harness-specific tests for PI.
- [ ] Update session API blackbox tests to cover registry-backed harness validation.
- [ ] Update runtime docs in `agent-go/README.md`.
- [ ] Update `agent-go/SPECS.md`.

## Phase 6: `agent-manager-web` Registry Foundation

- [ ] Add `agent-manager-web/src/harnesses/types.ts`.
- [ ] Add `agent-manager-web/src/harnesses/registry.ts`.
- [ ] Add a fallback harness definition for unknown harness IDs.
- [ ] Load harness modules through `import.meta.glob()` so frontend harness definitions can auto-register.

## Phase 7: `agent-manager-web` Harness Modules

- [ ] Add `src/harnesses/codex/index.ts`.
- [ ] Add `src/harnesses/pi/index.ts`.
- [ ] Move harness-specific model list logic out of `agent-session.tsx` and into harness modules.
- [ ] Move harness-specific thinking-level logic out of `agent-session.tsx` and into harness modules.
- [ ] Move harness-specific message renderer selection out of `agent-session.tsx` and into harness modules.

## Phase 8: `agent-manager-web` Session UI Refactor

- [ ] Refactor `agent-session.tsx` to resolve harness behavior from the registry.
- [ ] Stop narrowing session harness to `'codex' | 'pi'` in `agent-session.tsx`.
- [ ] Stop defaulting unknown harnesses to `codex`.
- [ ] Preserve unknown harness strings in `agent-detail.tsx` config normalization.
- [ ] Preserve unknown harness strings when opening sessions from the session list.
- [ ] Preserve unknown harness strings when selecting sessions from the session picker.
- [ ] Keep the fallback message renderer for unrecognized harnesses.

## Phase 9: Frontend Contracts and Docs

- [ ] Regenerate `agent-manager-web/src/api/generated/agent-manager.ts` if manager OpenAPI changes.
- [ ] Update `agent-manager-web/src/components/tool.tsx` if tool-call session creation typing should allow arbitrary harness IDs.
- [ ] Update `agent-manager-web/src/workspace/README.md` to reflect registry-driven harness behavior.
- [ ] Add tests for harness preservation in `agent-detail`.
- [ ] Add tests for harness lookup behavior in `agent-session`.

## Phase 10: New Harness Trial Run

- [ ] Add a sample third harness such as `opencode` in `agent-go/internal/harness/opencode/`.
- [ ] Add a matching frontend harness module in `agent-manager-web/src/harnesses/opencode/index.ts`.
- [ ] Add a matching message renderer such as `agent-manager-web/src/components/messages/opencode-message.tsx`.
- [ ] Confirm that no manager route/service code requires a harness-specific change.
- [ ] Confirm that the only required runtime wiring is harness package registration.
- [ ] Confirm that the only required frontend wiring is the new harness module and renderer.

## Phase 11: Exit Criteria

- [ ] `agent-manager` accepts and forwards arbitrary non-empty harness strings.
- [ ] `agent-go` has no central `codex` vs `pi` execution switch.
- [ ] `agent-manager-web` has no central `codex` vs `pi` UI switch for models, thinking levels, or renderers.
- [ ] Unknown harnesses are preserved rather than dropped in panel config.
- [ ] A new harness can be added without scattered edits across session UI logic.
