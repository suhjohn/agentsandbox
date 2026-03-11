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
- Sets a minimal setup-script environment in that sandbox: `AGENT_HOME`, `AGENT_ID`, `WORKSPACES_DIR`, `ROOT_DIR`, `CODEX_HOME`, `PI_CODING_AGENT_DIR`, and `HOME`.
- Attaches Modal secrets by name from:
  - `input.modalSecretName` (or default `openinspect-build-secret`), and
  - `input.environmentSecretNames`.
- Missing secret names are logged to build stderr and ignored.
- Always runs an internal setup sequence before snapshotting:
  - source sync via `agent-go/docker/update-agent-go-source.sh` when available, forcing the checkout to match the remote branch and failing the build if sync fails,
  - then `input.setupScript` if non-empty,
  - then verifies `/opt/agentsandbox/agent-go/build-artifacts/agent-server` exists and is executable before snapshotting.
- Materializes `fileSecrets` into secret files at their exact configured paths in the sandbox before snapshotting.
  - Builds fail with a descriptive error when a binding path resolves to an existing directory (for example `~/.venv`), because the secret must be written to a file path.

## image.service.ts

### `createImage(input)` / `updateImage(id, input)` / `cloneImage(input)`

Behavior:
- Image records now persist two separate script fields:
  - `setupScript`: runs during image build.
  - `runScript`: runs each time an agent sandbox starts from that image.
- `cloneImage` copies both script fields onto the cloned image.

### `createImageVariant(input)`

```ts
createImageVariant(input: {
  readonly imageId: string
  readonly name?: string
  readonly scope: "shared" | "private"
  readonly ownerUserId?: string | null
  readonly baseImageId?: string | null
})
```

Behavior:
- For `scope: "private"`, the variant row is owned by `ownerUserId` (and `ownerUserId` is cleared for `scope: "shared"`).
- When `name` is omitted/blank for a private variant, the service auto-numbers `Variant`, `Variant 2`, `Variant 3`, ... per `(imageId, ownerUserId)` to avoid unique-index collisions.

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
  type?: "worker" | "coordinator"
  visibility?: "private" | "shared"
})
```

Behavior:
- Generates the agent `id` in application code as a UUIDv7 before inserting.
- Derives the default agent `name` from that generated ID by seeding `unique-names-generator` with built-in adjective, color, and animal dictionaries, then normalizing spaces to `-`.
- Retries creation when either the generated `id` or derived `name` collides with an existing row.
- Defaults `type` to `"worker"` and `visibility` to `"private"` when callers omit them.
- Persists a browser-facing sandbox access token separately from the runtime-internal secret used for manager/runtime traffic.

### `getOrCreateDefaultCoordinatorAgentForUser(input)`

```ts
getOrCreateDefaultCoordinatorAgentForUser(input: {
  readonly userId: string
})
```

Behavior:
- Resolves `global_settings.defaultCoordinatorImageId` as the bootstrap image source.
- Reuses the user's latest non-archived root coordinator agent for that default image when one already exists.
- Otherwise creates a new private `type: "coordinator"` agent for that user, seeded from the default image and its default variant.
- Uses a per-user lock to avoid creating duplicate bootstrap coordinator agents during concurrent login or `/me` requests.

### `listAgents(input)`

```ts
listAgents(input: {
  viewerUserId: string
  imageId?: string
  noImage?: boolean
  status?: AgentStatus
  archived?: boolean
  parentAgentId?: string
  search?: string
  createdBy?: string
  type?: "worker" | "coordinator"
  visibility?: "private" | "shared"
  limit: number
  cursor?: string
})
```

Behavior:
- Only returns agents visible to `viewerUserId`: the viewer's own agents plus any `visibility: "shared"` agents.
- Supports app-level filtering on `type` and `visibility`.
- Continues to exclude archived agents by default unless callers explicitly request them.

### `listAgentGroups(input)`

```ts
listAgentGroups(input: {
  viewerUserId: string
  by: "imageId" | "createdBy"
  previewN: number
  archived?: boolean
  type?: "worker" | "coordinator"
  visibility?: "private" | "shared"
})
```

Behavior:
- Applies the same viewer visibility rule as `listAgents`.
- Supports grouping only across the subset of agents visible to `viewerUserId`.
- Supports app-level filtering on `type` and `visibility` before grouping.

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

## auth.service.ts

### `registerUser(input)` / `loginUser(input)` / `loginWithGithub(input)`

Behavior:
- `loginUser` rejects accounts whose `passwordHash` is `NULL`; GitHub-only accounts cannot use password login until a local password is set by some future flow.
- `loginWithGithub` accepts an optional `avatarUrl` and syncs the GitHub avatar into configured static-file storage when the user currently has no avatar or is still using a GitHub-managed avatar path.
- New GitHub-created users are persisted with `passwordHash: null` instead of a random placeholder hash.
- All three auth entrypoints best-effort call `getOrCreateDefaultCoordinatorAgentForUser` after the user record is resolved, using the configured global default coordinator image when available.

## avatar.service.ts

### `uploadGithubAvatar(input)` / `uploadCustomAvatar(input)` / `readAvatar(path)` / `deleteAvatarPath(path)`

Behavior:
- Uses S3-compatible object storage when `STATIC_FILES_S3_BUCKET` is configured.
- Falls back to the local filesystem under `STATIC_FILES_LOCAL_DIR` when S3 is not configured, so avatar upload/download works in local development without extra infrastructure.
- Stores avatar files under deterministic per-user paths:
  - `avatars/<userId>/github-<timestamp>.<ext>`
  - `avatars/<userId>/custom-<timestamp>.<ext>`
- Uses versioned filenames so browser/disk caches do not keep serving a stale avatar after upload/reset.
- Accepts JPEG, PNG, WebP, GIF, and AVIF avatars up to 5 MB.
- Returns/stores only relative object keys / filesystem-relative paths in Postgres; raw avatar bytes are never stored in the database.

## user.service.ts

### `createUser(input)` / `updateUser(id, input)`

Behavior:
- `createUser` now accepts nullable `passwordHash` and nullable `avatar`.
- `updateUser` now accepts nullable `avatar` so avatar reset/upload flows can update the persisted storage pointer independently of profile settings.

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
    readonly harness?: string
    readonly model?: string
    readonly modelReasoningEffort?: string
  }
})
```

Behavior:
- Creates the backing agent through `createAgent`, so bootstrap requests do not accept a caller-provided agent name.
- Preserves optional runtime session metadata such as `title`, `harness`, `model`, and `modelReasoningEffort` when creating the deterministic runtime session and first run.
- Treats `harness` and `modelReasoningEffort` as pass-through strings and leaves harness-specific validation to `agent-go`.
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
    readonly harness?: string
    readonly model?: string
    readonly modelReasoningEffort?: string
  }
})
```

Behavior:
- Starts a new runtime session on an existing agent without exposing the runtime-internal secret to the caller.
- Creates the runtime session first, then sends the first message as the authenticated manager-side actor user.
- Treats `harness` and `modelReasoningEffort` as pass-through strings and leaves harness-specific validation to `agent-go`.
- Returns session IDs and stream URLs, but not browser/runtime auth tokens.

## sandbox.service.ts

### `ensureAgentSandbox(input)`

```ts
ensureAgentSandbox(input: {
  readonly agentId: string
  readonly imageId?: string
  readonly region?: SandboxRegion
  readonly waitForLock?: boolean
}): Promise<AgentSandboxResult>
```

Behavior:
- When creating a new sandbox, secret attachments include:
  - named default secret `openinspect-build-secret` (if present),
  - inline API key secret object (OpenAI/Anthropic/Google keys when configured),
  - image-bound environment secrets from `listEnvironmentSecrets(agent.imageId)`.
- Session sandboxes only inject runtime-specific env overrides (`PORT`, Docker toggles, auth/base-URL values, and optional `PI_CODING_AGENT_DIR`) and otherwise rely on the `agent-go` image/entrypoint defaults for paths and UI token wiring.
- Setup sandboxes likewise rely on container defaults for home/workspace paths, but explicitly force `AGENT_RUNTIME_MODE=server`.
- When the source image has a non-empty `runScript`, sandbox startup is wrapped so that script runs once before `/opt/agentsandbox/agent-go/build-artifacts/agent-server serve`.
- If an agent no longer has an owner (`created_by` is `NULL`), sandbox creation fails with `409 Agent owner is missing`.
- Missing environment secret names are logged and skipped instead of failing sandbox creation.
- Post-create sandbox health waits up to 5 minutes by default (configurable via `SESSION_SANDBOX_POST_CREATE_HEALTH_TIMEOUT_MS` / `AGENT_SANDBOX_POST_CREATE_HEALTH_TIMEOUT_MS`).
- Manager-side `/health` probes to `*.modal.host` sandbox tunnel URLs disable TLS certificate verification to avoid Bun-specific certificate validation failures on Modal tunnels.
- Agent sandboxes receive a per-runtime opaque `AGENT_INTERNAL_AUTH_SECRET`; manager/runtime traffic uses that secret instead of the legacy manager API-key path.
- `waitForLock: false` makes sandbox creation opportunistic: if the per-agent create lock is already held, the call fails immediately instead of waiting for the existing create/warmup flow.
