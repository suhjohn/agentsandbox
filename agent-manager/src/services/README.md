# Services API

This document tracks exported service signatures and behavior details that other modules depend on.

## build.ts

### `runModalImageBuild(input)`

```ts
runModalImageBuild(input: {
  readonly imageId: string
  readonly environmentSecretNames?: readonly string[]
  readonly baseImageId?: string | null
  readonly modalSecretName?: string
  readonly onChunk?: (chunk: BuildChunk) => void
}): Promise<{ readonly builtImageId: string }>
```

Behavior:
- Creates a Modal build sandbox.
- Sets a minimal build environment in that sandbox: `AGENT_HOME`, `AGENT_ID`, `WORKSPACES_DIR`, `ROOT_DIR`, `CODEX_HOME`, `PI_CODING_AGENT_DIR`, and `HOME`.
- Attaches Modal secrets by name from:
  - `input.modalSecretName` (or default `openinspect-build-secret`), and
  - `input.environmentSecretNames`.
- Missing secret names are logged to build stderr and ignored.
- Always runs an internal setup sequence before snapshotting:
  - source sync via `agent-go/docker/update-agent-go-source.sh` when available, forcing the checkout to match the remote branch and failing the build if sync fails,
  - then `/shared/image-hooks/build.sh` if that file exists in the image-scoped shared hook volume; when the hook is readable but not executable, the builder stages a temporary copy, `chmod +x`s that copy, and runs it,
  - then verifies `/opt/agentsandbox/agent-go/build-artifacts/agent-server` exists and is executable before snapshotting.

## image.service.ts

### `createImage(input)` / `updateImage(id, input)` / `cloneImage(input)`

Behavior:
- Image records no longer persist build/start script text.
- Build customization now comes from `/shared/image-hooks/build.sh` in the image-scoped shared hook volume.
- Agent sandbox startup customization now comes from `/shared/image-hooks/start.sh` in the image-scoped shared hook volume.
- `/shared` is a mounted Modal volume inside these sandboxes, so hook-file edits persist independently of setup-sandbox filesystem snapshots.
- `cloneImage` copies the source image's shared hook files into the cloned image's hook volume and still copies the source default variant active/draft image pointers.
- Hydrated image responses expose:
  - `defaultVariantId`: the image-level shared fallback.
  - `userDefaultVariantId`: the current user's override for that image, or `null`.
  - `effectiveDefaultVariantId`: `userDefaultVariantId ?? defaultVariantId`.

### `createImageVariant(input)`

```ts
createImageVariant(input: {
  readonly imageId: string
  readonly name?: string
  readonly scope: "shared" | "personal"
  readonly ownerUserId?: string | null
  readonly activeImageId?: string | null
  readonly draftImageId?: string | null
})
```

Behavior:
- For `scope: "personal"`, the variant row is owned by `ownerUserId` (and `ownerUserId` is cleared for `scope: "shared"`).
- When `name` is omitted/blank for a personal variant, the service auto-numbers `Variant`, `Variant 2`, `Variant 3`, ... per `(imageId, ownerUserId)` to avoid unique-index collisions.
- `activeImageId` is the stable image pointer used for new agent sandboxes.
- `draftImageId` is the mutable image pointer used for builds and setup sandboxes.
- When callers omit `activeImageId`, the variant starts from the default ref `ghcr.io/suhjohn/agentsandbox:latest`.
- When callers omit `draftImageId`, it defaults to the resolved `activeImageId`.

### `updateImageVariant(input)`

```ts
updateImageVariant(input: {
  readonly imageId: string
  readonly variantId: string
  readonly name?: string
  readonly activeImageId?: string | null
  readonly draftImageId?: string | null
  readonly scope?: "shared" | "personal"
  readonly ownerUserId?: string | null
})
```

Behavior:
- Updates the variant name when `name` is provided.
- Updates the variant `activeImageId` when `activeImageId` is provided.
- Updates the variant `draftImageId` when `draftImageId` is provided.
- Updates the variant scope between `personal` and `shared`.
- Shared variants clear `ownerUserId`; personal variants assign `ownerUserId`.
- When switching a variant to `personal`, the service auto-renames on conflict using `Variant`, `Variant 2`, ... style suffixing for that owner scope.
- Explicit rename collisions fail with `Variant name already exists`.

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
- Passes environment secret names to `runModalImageBuild` via `environmentSecretNames`.
- Includes `environmentSecretNames` in the build input payload/hash.
- Uses the variant's current `draftImageId` as the build base and records that value as `baseImageId` in the build input payload.
- On success, writes the produced Modal image id directly back to the variant's `draftImageId`.

### `setUserImageDefaultVariantId(input)` / `clearUserImageDefaultVariantId(input)` / `resolveImageVariantForUser(input)`

Behavior:
- Per-user image default overrides are stored in `user_image_variant_defaults` keyed by `(userId, imageId)`.
- `resolveImageVariantForUser` resolves in this order:
  - explicit `variantId` when one is supplied,
  - then the user's override for that image,
  - then the image's shared `defaultVariantId`.

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
- Otherwise creates a new private `type: "coordinator"` agent for that user, seeded from the default image and that user's effective default variant for the image.
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

### `createSetupSandbox(input)`

```ts
createSetupSandbox(input: {
  readonly imageId: string
  readonly variantId: string
  readonly userId: string
  readonly region?: SandboxRegion
  readonly sshPublicKeys?: readonly string[]
}): Promise<{
  readonly sandboxId: string
  readonly variantId: string
  readonly draftImageId: string
  readonly authorizedPublicKeys: readonly string[]
  readonly ssh: {
    readonly username: string
    readonly host: string
    readonly port: number
    readonly hostPublicKey: string
    readonly hostKeyFingerprint: string
    readonly knownHostsLine: string
  } | null
}>
```

Behavior:
- Creates the setup sandbox from the selected variant `draftImageId`.
- Continues to expose the existing setup terminal/API over encrypted port `8080`.
- Always reserves sandbox port `22` for optional SSH access on the running setup sandbox.
- When `sshPublicKeys` is provided and non-empty, provisions `authorized_keys` for the `root` user, starts `sshd`, and returns the tunnel host/port plus host verification material.
- When `sshPublicKeys` is omitted or empty, the setup sandbox still starts normally, `authorizedPublicKeys` is empty, and `ssh` is returned as `null`.

### `upsertSetupSandboxSshAccess(input)`

```ts
upsertSetupSandboxSshAccess(input: {
  readonly userId: string
  readonly sandboxId: string
  readonly sshPublicKeys: readonly string[]
}): Promise<{
  readonly authorizedPublicKeys: readonly string[]
  readonly ssh: {
    readonly username: string
    readonly host: string
    readonly port: number
    readonly hostPublicKey: string
    readonly hostKeyFingerprint: string
    readonly knownHostsLine: string
  } | null
}>
```

Behavior:
- Looks up the live setup sandbox session for the caller.
- Merges the provided SSH public keys with any keys already authorized for that sandbox.
- Rewrites `authorized_keys`, starts or restarts `sshd`, and returns the current authorized key list plus SSH connection metadata.

### `closeSetupSandbox(input)`

```ts
closeSetupSandbox(input: {
  readonly userId: string
  readonly sandboxId: string
}): Promise<{
  readonly baseImageId: string
  readonly draftImageId: string
  readonly variantId: string
}>
```

Behavior:
- Before snapshotting, recursively normalizes `/home/agent` ownership back to `agent:agent` so files created over root SSH remain usable to the normal agent user in later sandboxes.
- Snapshots the live setup sandbox filesystem, writes the snapshot image id back to the variant's `draftImageId`, and terminates the sandbox.
- Records the previous variant `draftImageId` as `baseImageId` in a succeeded `image_variant_builds` row with source `setup-sandbox`.

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
- Session sandboxes mount the image-scoped shared hook volume read-only at `/shared/image-hooks`; setup sandboxes mount the same volume read-write.
- When `/shared/image-hooks/start.sh` exists in the shared hook volume, session sandbox startup runs that hook once before `/opt/agentsandbox/agent-go/build-artifacts/agent-server serve`.
- Because the session sandbox hook mount is read-only, a readable but non-executable `/shared/image-hooks/start.sh` is staged to a temporary file, `chmod +x` is applied to that temp copy, and the temp copy is run.
- If an agent no longer has an owner (`created_by` is `NULL`), sandbox creation fails with `409 Agent owner is missing`.
- Missing environment secret names are logged and skipped instead of failing sandbox creation.
- Post-create sandbox health waits up to 5 minutes by default (configurable via `SESSION_SANDBOX_POST_CREATE_HEALTH_TIMEOUT_MS` / `AGENT_SANDBOX_POST_CREATE_HEALTH_TIMEOUT_MS`).
- Manager-side `/health` probes to `*.modal.host` sandbox tunnel URLs disable TLS certificate verification to avoid Bun-specific certificate validation failures on Modal tunnels.
- Agent sandboxes receive a per-runtime opaque `AGENT_INTERNAL_AUTH_SECRET`; manager/runtime traffic uses that secret exclusively.
- `waitForLock: false` makes sandbox creation opportunistic: if the per-agent create lock is already held, the call fails immediately instead of waiting for the existing create/warmup flow.
