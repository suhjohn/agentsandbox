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
- Always runs an internal setup sequence before snapshotting:
  - source sync via `agent-go-update-source` when available,
  - then `input.setupScript` if non-empty,
  - then builds the `agent-go` binary to `/app/agent-server`.
- Materializes `fileSecrets` into `.env` files in the sandbox before snapshotting.

## image.service.ts

### `createImage(input)` / `updateImage(id, input)` / `cloneImage(input)`

Behavior:
- Image records now persist two separate script fields:
  - `setupScript`: runs during image build.
  - `runScript`: runs each time an agent sandbox starts from that image.
- `cloneImage` copies both script fields onto the cloned image.

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

## agent.service.ts

### `createAgent(input)`

```ts
createAgent(input: {
  parentAgentId?: string | null
  imageId: string
  imageVariantId?: string | null
  createdBy: string
  region?: Region
})
```

Behavior:
- Generates the agent `id` in application code as a UUIDv7 before inserting.
- Derives the default agent `name` from that generated ID as `ag-<first 16 chars of uuid>`.
- Retries creation when either the generated `id` or derived `name` collides with an existing row.

## session.service.ts

### `createSessionBootstrap(input)`

```ts
createSessionBootstrap(input: {
  readonly user: AuthUser
  readonly body: {
    readonly parentAgentId?: string
    readonly imageId: string
    readonly region?: string | readonly string[]
    readonly message: string
    readonly title?: string
    readonly harness?: "codex" | "pi"
    readonly model?: string
    readonly modelReasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh"
  }
})
```

Behavior:
- Creates the backing agent through `createAgent`, so bootstrap requests do not accept a caller-provided agent name.
- Preserves optional runtime session metadata such as `title`, `harness`, `model`, and `modelReasoningEffort` when creating the deterministic runtime session and first run.

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
- When the source image has a non-empty `runScript`, sandbox startup is wrapped so that script runs once before `agent-server serve`.
- If an agent no longer has an owner (`created_by` is `NULL`), sandbox creation fails with `409 Agent owner is missing`.
- Missing environment secret names are logged and skipped instead of failing sandbox creation.
- Post-create sandbox health waits up to 5 minutes by default (configurable via `SESSION_SANDBOX_POST_CREATE_HEALTH_TIMEOUT_MS` / `AGENT_SANDBOX_POST_CREATE_HEALTH_TIMEOUT_MS`).
