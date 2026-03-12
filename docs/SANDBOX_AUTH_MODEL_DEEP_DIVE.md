# Sandbox Authentication Model Deep Dive (Current Implementation)

Last verified: 2026-03-03

This document was refreshed from code by:

- BFS search over manager/frontend/runtime for sandbox/auth/terminal/token flows.
- DFS tracing from route entrypoints to token minting, runtime verification, and callback dispatch.

It covers both:

- regular agent runtime sandboxes
- image setup/build sandboxes

## 1. Scope and Primary Code Paths (BFS Inventory)

### 1.1 Manager API/auth entrypoints

- `agent-manager/src/app.ts`
- `agent-manager/src/env.ts`
- `agent-manager/src/log.ts`
- `agent-manager/src/types/context.ts`
- `agent-manager/src/routes/auth.ts`
- `agent-manager/src/routes/agents.ts`
- `agent-manager/src/routes/session.ts`
- `agent-manager/src/routes/terminal.ts`
- `agent-manager/src/routes/images.ts`
- `agent-manager/src/middleware/auth.ts`
- `agent-manager/src/middleware/agent-auth.ts`
- `agent-manager/src/middleware/session-auth.ts`

### 1.2 Manager services and persistence affecting auth behavior

- `agent-manager/src/services/auth.service.ts`
- `agent-manager/src/services/sandbox.service.ts`
- `agent-manager/src/services/session.service.ts`
- `agent-manager/src/services/agent.service.ts`
- `agent-manager/src/services/image.service.ts`
- `agent-manager/src/db/schema.ts`

### 1.3 Frontend token/runtime clients

- `agent-manager-web/src/lib/auth.tsx`
- `agent-manager-web/src/lib/terminal-connect.ts`
- `agent-manager-web/src/api/orval-agent-fetcher.ts`
- `agent-manager-web/src/components/terminal-panel.tsx`
- `agent-manager-web/src/workspace/panels/agent-terminal.tsx`
- `agent-manager-web/src/workspace/panels/agent-session.tsx`
- `agent-manager-web/src/components/workspace-diff-panel.tsx`
- `agent-manager-web/src/workspace/hooks/use-agent-runtime-access.ts`
- `agent-manager-web/src/routes/settings-image-detail.tsx`

### 1.4 Runtime auth enforcement and callback transport

- `agent-go/internal/server/serve.go`
- `agent-go/internal/server/terminal.go`
- `agent-go/internal/terminal/ws.go`
- `agent-go/internal/server/outbox.go`
- `agent-go/internal/openvscodeproxy/proxy.go`

### 1.5 Runtime boot and sidecar scripts consuming auth env

- `agent-go/docker/start.sh`
- `agent-go/docker/runit/openvscode-server.sh`
- `agent-go/docker/runit/ui-stack.sh`
- `agent-go/docker/runit/openvscode-proxy.sh`

### 1.6 Tests currently covering key auth paths

- `agent-manager/tests/integration/setup-sandbox-ownership.int.test.ts`
- `agent-manager/tests/integration/sessions.sandbox-agent-api.real.int.test.ts`
- `agent-go/internal/server/server_integration_test.go`
- `agent-go/integration_test/integration_helpers_test.go`

## 2. Components and Trust Boundaries

Components:

1. Browser UI (`agent-manager-web`)
2. Manager API (`agent-manager`)
3. Runtime API (`agent-go` in Modal sandbox)
4. Modal control plane (sandbox lifecycle, tunnels, secret wiring)
5. Storage (`Postgres` + `Redis` + runtime sqlite)

Primary trust boundaries:

1. Browser -> Manager (user auth boundary)
2. Browser -> Runtime (sandbox-agent JWT boundary)
3. Manager -> Runtime (service-to-runtime sandbox-agent JWT boundary)
4. Runtime -> Manager callbacks (manager API key / bearer boundary)
5. Sandbox process -> secret material in env and injected Modal secrets

## 3. Secret Domains and Derivations

Manager enforces 3 separate secret domains (`agent-manager/src/env.ts`):

1. `USER_JWT_SECRET` (user access + refresh JWTs)
2. `SANDBOX_SIGNING_SECRET` (seed for sandbox-agent JWT key derivation)
3. `SANDBOX_TOKEN_ENCRYPTION_SECRET` (encrypt/decrypt persisted sandbox access token)

Sandbox access token storage (`agent-manager/src/services/agent.service.ts`, `agent-manager/src/db/schema.ts`):

- token generated as 32-hex (`crypto.randomUUID()` minus dashes)
- stored as `agents.sandbox_access_token`
- encrypted at rest with `AES-256-GCM`
- key = `SHA256(SANDBOX_TOKEN_ENCRYPTION_SECRET)`

Sandbox-agent JWT signing key derivation (`agent-manager/src/services/sandbox.service.ts`, `agent-go/internal/server/serve.go`):

- per-session signing key
- derivation: `HMAC_SHA256(SANDBOX_SIGNING_SECRET, "sandbox-agent:<sid>")`
- manager signs with derived key
- runtime recomputes derived key from `SECRET_SEED` + `sid`

Runtime seed hard requirements:

- `agent-go/docker/start.sh` fails startup if `SECRET_SEED` is missing or `< 32` chars.
- `agent-go/internal/server/serve.go` also rejects config if `SECRET_SEED` is `< 32` chars.

## 4. User Auth (Browser <-> Manager)

### 4.1 Login/register/GitHub callback

Routes:

- `POST /auth/register`
- `POST /auth/login`
- `GET /auth/github/callback`

Current behavior:

- login/register JSON responses expose only `user` + `accessToken`.
- GitHub callback returns HTML that `postMessage`s `{ user, accessToken }` to the opener.
- refresh token is set via cookie: `HttpOnly; Secure; SameSite=Strict`.
- refresh token is not returned in response JSON.

### 4.2 Refresh

Route: `POST /auth/refresh`

Current behavior:

- requires `X-Refresh-Csrf: 1`
- reads refresh token from cookie
- verifies refresh JWT with `type=refresh`
- returns fresh access token JSON

### 4.3 Frontend storage + refresh behavior

`agent-manager-web/src/lib/auth.tsx`:

- stores only `user` + `accessToken` in localStorage key `agent-manager-web/auth`
- keeps refresh token cookie-only
- retries one time on `401` by calling `/auth/refresh` with `X-Refresh-Csrf: 1`

Manager CORS config (`agent-manager/src/app.ts`) explicitly allows:

- `Authorization`
- `Content-Type`
- `X-Refresh-Csrf`

## 5. Agent Sandbox Runtime Auth Flow

### 5.1 Provisioning and IDE/VNC token wiring

Manager path: `ensureAgentSandbox` -> `createAgentSandboxModal` (`agent-manager/src/services/sandbox.service.ts`).

Runtime env injection includes:

- `AGENT_ID`
- `SECRET_SEED = SANDBOX_SIGNING_SECRET`
- `OPENVSCODE_CONNECTION_TOKEN = sandboxAccessToken`
- `VNC_PASSWORD = sandboxAccessToken`
- `AGENT_MANAGER_BASE_URL`
- `AGENT_ALLOWED_ORIGINS`

Allowed origins are composed from:

- manager public base URL
- `FRONTEND_URL`
- `AGENT_ALLOWED_ORIGINS`
- `VSCODE_PROXY_FRAME_ANCESTORS`

Manager returns OpenVSCode/noVNC URLs with query credentials:

- VS Code: `?tkn=<sandboxAccessToken>`
- noVNC: `?password=<sandboxAccessToken>`

### 5.2 Sandbox-agent JWT minting

`getSandboxAgentToken` mints short-lived runtime JWT with:

- claims: `sub`, `agentId`, `sid`, `typ=sandbox-agent`, `iat`, `exp`, `jti`
- default TTL: 5 minutes (`DEFAULT_SANDBOX_AGENT_TOKEN_TTL_SECONDS`)
- minimum clamp: 30 seconds

No Redis cache is used for sandbox-agent JWTs in current code. A fresh token is minted on each call.

### 5.3 Browser/runtime transports

Runtime auth token accepted via:

1. `X-Agent-Auth: Bearer <jwt>`
2. `Authorization: Bearer <jwt>`
3. websocket subprotocol token (`auth.bearer.<jwt>`, also `agent-auth.<jwt>` / `bearer.<jwt>`)

Current state:

- runtime does not accept `access_token` query-string auth

Terminal flow:

- manager `POST /terminal/connect` returns `wsUrl` + `authToken`
- frontend opens websocket with subprotocol `auth.bearer.<token>`

HTTP/SSE runtime calls from frontend are made with `X-Agent-Auth` in:

- `agent-manager-web/src/api/orval-agent-fetcher.ts`
- `agent-manager-web/src/workspace/panels/agent-session.tsx`
- `agent-manager-web/src/components/workspace-diff-panel.tsx`

### 5.4 Runtime verification (`agent-go`)

`requireAuth` (`agent-go/internal/server/serve.go`) does:

1. read token from allowed transports
2. parse unverified token to extract `sid`
3. derive per-`sid` secret from `SECRET_SEED`
4. verify JWT (`HS256` + standard claim checks)
5. enforce:
   - `typ == sandbox-agent`
   - payload `sid` matches extracted `sid`
   - `agentId` matches runtime `AGENT_ID`
   - non-empty `sub`

### 5.5 Runtime CORS and websocket origin enforcement

`agent-go/internal/server/serve.go`:

- CORS denies disallowed `Origin` with `403`
- allow-headers: `Authorization, Content-Type, X-Agent-Auth`
- `/terminal` is additionally gated by `requireAuth`

`agent-go/internal/terminal/ws.go`:

- websocket upgrade requires allowed non-empty `Origin`

`agent-go/internal/openvscodeproxy/proxy.go`:

- websocket proxy path also enforces allowed `Origin`

### 5.6 Runtime -> Manager callback path

`agent-go/internal/server/outbox.go` queues:

- `PUT /session/:id` (session sync)
- `POST /agents/:agentId/snapshot` (snapshot request)

Auth headers are injected at dispatch time, not stored in event rows:

- use `X-Agent-Internal-Auth` + `X-Agent-Id`

Persisted event rows store event-declared headers (for current callbacks, typically `content-type`) and not injected manager auth credentials.

Agent sandboxes now receive a per-runtime `AGENT_INTERNAL_AUTH_SECRET` and use it for both manager -> runtime and runtime -> manager traffic.

## 6. Setup/Build Sandbox Auth Flow

### 6.1 Setup sandbox creation

Route: `POST /images/:imageId/setup-sandbox`

Manager creates setup sandbox with:

- `AGENT_RUNTIME_MODE=server`
- `AGENT_ID=setup-<imageId>`
- `PORT=8080`
- `SECRET_SEED=SANDBOX_SIGNING_SECRET`
- `AGENT_MANAGER_BASE_URL`
- `AGENT_ALLOWED_ORIGINS`

### 6.2 Setup sandbox terminal auth

Route: `POST /terminal/connect` with `targetType=setupSandbox`

Manager mints sandbox-agent JWT with:

- `agentId=setup-<imageId>`
- `sid=setup-<sandboxId>`

and returns terminal websocket access.

### 6.3 Setup sandbox ownership checks + state model

Current behavior:

- `/terminal/connect` for `setupSandbox` verifies `session.userId == caller.user.id`
- setup snapshot and terminate routes also enforce owner check at route layer
- setup session metadata is in-memory map `IMAGE_SETUP_SANDBOXES` keyed by sandbox ID
- state is process-local (not durable across manager restart)

## 7. Manager Authorization Model (Current)

Current model remains broadly team-visible for many reads/accesses.

Examples:

- `/agents/:agentId/access` does not require `createdBy == caller`
- `/agents/health` does not scope `agentIds` to caller ownership
- session list/group routes are not caller-scoped by default
- image read guard `ensureCanReadImage(...)` is currently a no-op
- `canUserAccessImageVariant(...)` currently returns `true`

API-key modes:

1. `sessionAuth` (`agent-manager/src/middleware/session-auth.ts`)
   - API key allowed only for `PUT /session/:id`
   - route computes/retains `createdBy` server-side from target agent/existing session
2. `agentAuth` (`agent-manager/src/middleware/agent-auth.ts`)
   - API key allowed for `/agents/:agentId/*`
   - or `POST /agents` only when `parentAgentId` is present
   - middleware resolves effective user context from target/parent agent owner

## 8. OpenVSCode/noVNC Credential Consumption

Credential consumers:

- `agent-go/docker/runit/openvscode-server.sh` requires `OPENVSCODE_CONNECTION_TOKEN`
- `agent-go/docker/runit/ui-stack.sh` requires `VNC_PASSWORD`

Token transport to browser still uses manager-generated query params (`tkn`, `password`) from `buildModalSandboxAccessUrls`.

OpenVSCode proxy (`agent-go/internal/openvscodeproxy/proxy.go`) currently focuses on:

- websocket origin checks
- iframe cookie/CSP adjustments

It does not replace the manager-side query credential pattern.

## 9. DFS: End-to-End Auth Call Graphs

### 9.1 Agent access (IDE + runtime API token)

`GET /agents/:agentId/access` (`routes/agents.ts`) ->
`ensureAgentSandbox` (`services/sandbox.service.ts`) ->
`buildModalSandboxAccessUrls` + `getSandboxAgentToken` ->
frontend stores/uses `agentApiUrl` + `agentAuthToken` ->
runtime endpoints verify via `requireAuth` (`agent-go/internal/server/serve.go`).

### 9.2 Agent terminal websocket

`POST /terminal/connect` with `targetType=agentSandbox` (`routes/terminal.ts`) ->
`getAgentTerminalAccess` (`services/sandbox.service.ts`) ->
frontend `TerminalPanel` opens `wsUrl` with `auth.bearer.<token>` ->
runtime `/terminal` (`server/terminal.go`) calls `requireAuth` then `terminal.HandleWS`.

### 9.3 Setup sandbox terminal websocket

`POST /terminal/connect` with `targetType=setupSandbox` (`routes/terminal.ts`) ->
route checks setup sandbox owner ->
`getSetupSandboxTerminalAccess` ->
JWT minted with `agentId=setup-<imageId>`, `sid=setup-<sandboxId>` ->
runtime terminal verifies same sandbox-agent contract.

### 9.4 Runtime callback dispatch

runtime mutation/session paths queue events ->
`eventOutbox.dispatchEvent` merges stored event headers +
runtime-internal auth headers when callback URL matches manager base ->
manager receives callbacks under runtime-internal auth in `sessionAuth`.

## 10. Transport Matrix (Current)

| Hop | Artifact | Key/Secret Domain | Transport |
| --- | --- | --- | --- |
| Browser -> Manager protected API | user access JWT | `USER_JWT_SECRET` | `Authorization` header |
| Browser -> Manager refresh | refresh JWT | `USER_JWT_SECRET` | `HttpOnly` cookie + `X-Refresh-Csrf` |
| Manager -> Browser runtime access payload | sandbox-agent JWT | `HMAC(SANDBOX_SIGNING_SECRET, "sandbox-agent:<sid>")` | JSON body |
| Browser -> Runtime REST/SSE | sandbox-agent JWT | same | `X-Agent-Auth` (or `Authorization`) |
| Browser -> Runtime terminal WS | sandbox-agent JWT | same | `Sec-WebSocket-Protocol` token |
| Manager -> Runtime internal calls | opaque per-runtime secret | encrypted on `agents.runtime_internal_secret` | `X-Agent-Internal-Auth` + `X-Actor-User-Id` |
| Manager -> OpenVSCode/noVNC links | sandbox access token | encrypted by `SANDBOX_TOKEN_ENCRYPTION_SECRET` at rest | URL query (`tkn`, `password`) |
| Runtime -> Manager callbacks | opaque per-runtime secret | encrypted on `agents.runtime_internal_secret` | `X-Agent-Internal-Auth` + `X-Agent-Id` |

## 11. Drift Corrections and Open Constraints

Drift corrections from older docs:

1. Sandbox-agent JWTs are not Redis-cached.
2. Runtime does not accept `access_token` query auth.
3. Login/register responses do not return refresh token JSON.
4. Frontend does not store refresh token in localStorage.
5. Runtime outbox does not persist injected manager auth headers in DB event rows.
6. Auth-relevant file surface is broader than earlier deep-dive scope (notably `app.ts`, `log.ts`, `routes/session.ts`, `services/image.service.ts`, frontend workspace panels, runtime runit scripts).

Current open constraints:

1. OpenVSCode/noVNC still rely on URL query credential transport (`tkn`, `password`).
2. Runtime sandbox still receives high-value static secrets (`SECRET_SEED`, manager API key, provider keys in runtime flow).
3. Sandbox-agent JWTs include `jti`, but runtime does not enforce replay/JTI tracking.
4. `iss` / `aud` are not enforced for sandbox-agent JWTs.
5. Setup sandbox session state remains in-memory only.
