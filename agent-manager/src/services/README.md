# Services API

This document tracks exported service signatures and behavior details that other modules depend on.

## build.ts

### `runModalImageBuild(input)`

```ts
runModalImageBuild(input: {
  readonly imageId: string
  readonly setupScript: string
  readonly fileSecrets: readonly BuildFileSecretBinding[]
  readonly environmentSecretNames?: readonly string[]
  readonly baseImageId?: string | null
  readonly modalSecretName?: string
  readonly onChunk?: (chunk: BuildChunk) => void
}): Promise<{ readonly builtImageId: string }>
```

Behavior:
- Creates a Modal build sandbox.
- Attaches Modal secrets by name from:
  - `input.modalSecretName` (or default `openinspect-build-secret`), and
  - `input.environmentSecretNames`.
- Missing secret names are logged to build stderr and ignored.
- Materializes `fileSecrets` into `.env` files in the sandbox before snapshotting.
- Runs an agent source sync preamble (`agent-go-update-source` when available) before executing `setupScript`.

## image.service.ts

### `runBuild(input)`

```ts
runBuild(input: {
  readonly imageRecordId: string
  readonly variantId: string
  readonly userId: string
  readonly onChunk?: (chunk: BuildChunk) => void
})
```

Behavior:
- Loads both file secret bindings (`listFileSecrets`) and environment secret bindings (`listEnvironmentSecrets`) for `imageRecordId`.
- Passes environment secret names to `runModalImageBuild` via `environmentSecretNames`.
- Includes both `fileSecrets` and `environmentSecretNames` in the build input payload/hash.

## sandbox.service.ts

### `ensureAgentSandbox(input)`

```ts
ensureAgentSandbox(input: {
  readonly agentId: string
  readonly imageId?: string
  readonly region?: SandboxRegion
}): Promise<AgentSandboxResult>
```

Behavior:
- When creating a new sandbox, secret attachments include:
  - named default secret `openinspect-build-secret` (if present),
  - inline API key secret object (OpenAI/Anthropic/Google/manager API keys when configured),
  - image-bound environment secrets from `listEnvironmentSecrets(agent.imageId)`.
- Missing environment secret names are logged and skipped instead of failing sandbox creation.
- Post-create sandbox health waits up to 5 minutes by default (configurable via `SESSION_SANDBOX_POST_CREATE_HEALTH_TIMEOUT_MS` / `AGENT_SANDBOX_POST_CREATE_HEALTH_TIMEOUT_MS`).
