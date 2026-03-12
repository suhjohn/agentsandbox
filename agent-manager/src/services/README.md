# Services API

This document tracks exported service signatures and behavior details that other modules depend on.

## image.service.ts

### `createImage(input)` / `updateImage(id, input)` / `cloneImage(input)`

Behavior:

- Image records no longer persist build/start script text.
- Build customization now comes from `/shared/image/hooks/build.sh` in the image-scoped shared volume.
- Agent sandbox startup customization now comes from `/shared/image/hooks/start.sh` in the image-scoped shared volume.
- `/shared` is a mounted Modal volume inside these sandboxes, so hook-file edits persist independently of setup-sandbox filesystem snapshots.
- The image-scoped shared hook volume is created as a Modal Volume v2.
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
- Shared variants are mutable by any user who can reach the route; personal variants remain mutable only by the personal owner or the image owner.
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

- Passes environment secret names to `runImageBuild` via `environmentSecretNames`.
- Includes `environmentSecretNames` in the build input payload/hash.
- Uses the variant's current `draftImageId` as the build base and records that value as `baseImageId` in the build input payload.
- On success, writes the produced Modal image id directly back to the variant's `draftImageId`.

### `setUserImageDefaultVariantId(input)` / `clearUserImageDefaultVariantId(input)` / `resolveImageVariantForUser(input)`

Behavior:

- Any user who can reach the route can set the image-level shared default variant.
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
- Persists a browser-facing sandbox access token separately from manager API keys used for manager/runtime traffic.

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

### `setAgentSandbox(input)`

```ts
setAgentSandbox(input: {
  id: string
  currentSandboxId: string
})
```

Behavior:

- Records the current live sandbox id for an agent.
- Clearing or replacing the current sandbox clears the live sandbox pointer for the old runtime.

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
- Uses the runtime's normal sandbox agent token (`X-Agent-Auth`) for manager-origin `/session` and `/session/:id/message` calls, while still returning browser/runtime access payloads separately.

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

- Starts a new runtime session on an existing agent without exposing sandbox credentials to the caller.
- Creates the runtime session first, then sends the first message as the authenticated manager-side actor user.
- Treats `harness` and `modelReasoningEffort` as pass-through strings and leaves harness-specific validation to `agent-go`.
- Returns session IDs and stream URLs, but not browser/runtime auth tokens.

## sandbox-core.ts

Shared sandbox runtime primitives used by build, setup, and agent workflows.

### `buildSandboxRuntimeAccess(input)`

```ts
buildSandboxRuntimeAccess(input: {
  readonly sandboxId: string
  readonly runtimeBaseUrl: string
  readonly sandboxAccessToken: string
  readonly userId: string
  readonly sessionId: string
  readonly subjectId: string
  readonly authTtlSeconds?: number
  readonly openVscodeBaseUrl?: string | null
  readonly noVncBaseUrl?: string | null
  readonly ssh?: SetupSandboxSshAccess | null
}): Promise<SandboxRuntimeAccess>
```

Behavior:

- Returns the unified runtime access payload used by both setup and agent workflows.
- Folds terminal access into the runtime access object instead of treating terminal access as a separate service API.
- Uses one runtime auth token for both runtime API and terminal access.
- Adds OpenVSCode/noVNC URLs only when those base URLs are available.

### `createModalSandbox(input)`

```ts
createModalSandbox(input: {
  readonly appName: string
  readonly image: ModalImage
  readonly command: readonly string[]
  readonly secrets: readonly unknown[]
  readonly volumes?: Record<string, unknown>
  readonly encryptedPorts?: readonly number[]
  readonly unencryptedPorts?: readonly number[]
  readonly timeoutMs: number
  readonly idleTimeoutMs?: number
  readonly regions?: readonly string[]
  readonly experimentalOptions?: Record<string, unknown>
}): Promise<SandboxHandle>
```

Behavior:

- Creates a Modal sandbox from explicit create arguments without introducing a shared “sandbox spec” object.
- Keeps Modal app selection as an internal creation parameter rather than part of the public sandbox runtime model.

## build.workflow.ts

### `runImageBuild(input)`

```ts
runImageBuild(input: {
  readonly imageId: string
  readonly environmentSecretNames?: readonly string[]
  readonly baseImageId?: string | null
  readonly modalSecretName?: string
  readonly onChunk?: (chunk: BuildChunk) => void
}): Promise<{ readonly builtImageId: string }>
```

Behavior:

- Creates a one-shot build sandbox.
- Injects startup env through an inline Modal secret and attaches named/environment secrets by name.
- Always runs `agent-go/docker/build.sh` inside the sandbox before snapshotting.
- Snapshots the filesystem and terminates the sandbox on completion.

## setup.workflow.ts

### `createSetupSandboxSession(input)`

```ts
createSetupSandboxSession(input: {
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
  readonly ssh: SetupSandboxSshAccess | null
}>
```

Behavior:

- Creates a setup sandbox using the same maximal runtime shape as agent sandboxes.
- Exposes the standard runtime API, terminal, OpenVSCode, and noVNC ports.
- Optionally provisions SSH on port `22` when public keys are supplied.
- Tracks setup-session state in-memory, including the setup sandbox access token and SSH metadata.

### `getSetupSandboxRuntimeAccess(input)`

```ts
getSetupSandboxRuntimeAccess(input: {
  readonly userId: string
  readonly sandboxId: string
  readonly authTtlSeconds?: number
}): Promise<SandboxRuntimeAccess>
```

Behavior:

- Returns the same runtime access shape used for agent sandboxes.
- Enforces setup-session ownership before returning runtime or UI access.

### `upsertSetupSandboxSshAccess(input)`

```ts
upsertSetupSandboxSshAccess(input: {
  readonly userId: string
  readonly sandboxId: string
  readonly sshPublicKeys: readonly string[]
}): Promise<{
  readonly authorizedPublicKeys: readonly string[]
  readonly ssh: SetupSandboxSshAccess | null
}>
```

### `finalizeSetupSandboxSession(input)`

```ts
finalizeSetupSandboxSession(input: {
  readonly userId: string
  readonly sandboxId: string
}): Promise<{
  readonly baseImageId: string
  readonly draftImageId: string
  readonly variantId: string
}>
```

Behavior:

- Normalizes `/home/agent` ownership before snapshotting so files created over root SSH remain usable later.
- Snapshots the live sandbox, updates the variant draft image id, records a succeeded `setup-sandbox` build row, and terminates the sandbox.

## agent.workflow.ts

### `ensureAgentSandbox(input)`

```ts
ensureAgentSandbox(input: {
  readonly agentId: string
  readonly imageId?: string
  readonly region?: SandboxRegion
  readonly waitForLock?: boolean
}): Promise<SandboxHandle>
```

Behavior:

- Returns a raw sandbox handle and keeps runtime access assembly separate.
- Reuses an existing healthy sandbox when possible.
- Creates a maximal runtime sandbox when one does not exist, using:
  - inline startup env secret,
  - named default secret `openinspect-build-secret` when present,
  - image-bound environment secrets,
  - inline provider API key secret when configured.
- Mounts the image-scoped hook volume read-write.

### `getAgentSandboxRuntimeAccess(input)`

```ts
getAgentSandboxRuntimeAccess(input: {
  readonly userId: string
  readonly agentId: string
  readonly authTtlSeconds?: number
}): Promise<SandboxRuntimeAccess>
```

Behavior:

- Returns the unified runtime access payload for agent sandboxes.
- Uses the same runtime/terminal/UI shape as setup sandboxes.

### `snapshotAgentSandbox(input)`

```ts
snapshotAgentSandbox(input: {
  readonly sandboxId: string
}): Promise<{ readonly imageId: string }>
```

### `terminateAgentSandbox(input)`

```ts
terminateAgentSandbox(input: {
  readonly sandboxId: string
}): Promise<void>
```
