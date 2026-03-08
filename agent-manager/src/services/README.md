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
  - source sync via `agent-go-update-source` when available, forcing the checkout to match the remote branch and failing the build if sync fails,
  - then `input.setupScript` if non-empty,
  - then removes any launcher symlink at `/app/agent-server` and builds the `agent-go` binary there.
- Materializes `fileSecrets` into secret files at their exact configured paths in the sandbox before snapshotting.

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
- Persists a browser-facing sandbox access token separately from the runtime-internal secret used for manager/runtime traffic.

### `setAgentSandbox(input)` / `getAgentRuntimeInternalSecret(id)` / `createAgentRuntimeInternalSecret(id)`

```ts
setAgentSandbox(input: {
  id: string
  currentSandboxId: string
  runtimeInternalSecret: string
})

getAgentRuntimeInternalSecret(id: string): Promise<string>

createAgentRuntimeInternalSecret(id: string): Promise<string>
```

Behavior:
- `runtimeInternalSecret` is the encrypted-at-rest opaque secret for the current live runtime only.
- The secret rotates whenever a new sandbox is created for an agent.
- Clearing or replacing the current sandbox also clears the stored runtime-internal secret for the old runtime.

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
- Uses manager-internal runtime auth (`X-Agent-Internal-Auth` + `X-Actor-User-Id`) for manager-origin `/session` and `/session/:id/message` calls, while still returning browser/runtime access payloads separately.

### `startAgentSession(input)`

```ts
startAgentSession(input: {
  readonly user: AuthUser
  readonly agentId: string
  readonly body: {
    readonly sessionId?: string
    readonly message: string
    readonly title?: string
    readonly harness?: "codex" | "pi"
    readonly model?: string
    readonly modelReasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh"
  }
})
```

Behavior:
- Starts a new runtime session on an existing agent without exposing the runtime-internal secret to the caller.
- Creates the runtime session first, then sends the first message as the authenticated manager-side actor user.
- Returns session IDs and stream URLs, but not browser/runtime auth tokens.

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
  - inline API key secret object (OpenAI/Anthropic/Google keys when configured),
  - image-bound environment secrets from `listEnvironmentSecrets(agent.imageId)`.
- When the source image has a non-empty `runScript`, sandbox startup is wrapped so that script runs once before `agent-server serve`.
- If an agent no longer has an owner (`created_by` is `NULL`), sandbox creation fails with `409 Agent owner is missing`.
- Missing environment secret names are logged and skipped instead of failing sandbox creation.
- Post-create sandbox health waits up to 5 minutes by default (configurable via `SESSION_SANDBOX_POST_CREATE_HEALTH_TIMEOUT_MS` / `AGENT_SANDBOX_POST_CREATE_HEALTH_TIMEOUT_MS`).
- Manager-side `/health` probes to `*.modal.host` sandbox tunnel URLs disable TLS certificate verification to avoid Bun-specific certificate validation failures on Modal tunnels.
- Agent sandboxes receive a per-runtime opaque `AGENT_INTERNAL_AUTH_SECRET`; manager/runtime traffic uses that secret instead of the legacy manager API-key path.
