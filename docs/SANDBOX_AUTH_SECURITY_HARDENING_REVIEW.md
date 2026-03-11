# Sandbox Auth Security Hardening Review (Current State)

Last reviewed: 2026-03-03

This review is based on current implementation in:

- `agent-manager`
- `agent-manager-web`
- `agent-go`

Primary emphasis:

- runtime sandbox auth
- setup sandbox auth
- browser-to-runtime token transport
- runtime-to-manager callback auth

## 1. Threat Model Baseline (Single-Tenant Context)

Assumptions:

1. This deployment is currently single-tenant, and no user-role partitioning is required.
2. Browser and manager may still be cross-origin deployments.
3. Sandboxes execute untrusted code by design.
4. Credential leakage (URL token, API key, callback token, sandbox seed) is realistic and remains high impact even in single-tenant mode.

Security objective:

- contain credential blast radius and lifetime
- minimize token leakage in URL, logs, and telemetry paths
- preserve clear auth-domain separation so one leak does not compromise all channels

Single-tenant implication:

- broad read visibility across users may be acceptable policy today
- hardening focus should prioritize secret handling, replay resistance, and callback credential scope over role-based data isolation

## 2. Hardening Status Snapshot

### 2.1 Implemented

1. Refresh token is cookie-only.

- login/register responses return access token JSON only
- refresh token is set in `HttpOnly` cookie
- frontend local storage no longer stores refresh token

2. Runtime query-string auth token (`access_token`) was removed.

- `agent-go` auth extraction uses headers and websocket subprotocol
- terminal websocket auth uses `Sec-WebSocket-Protocol` (`auth.bearer.<jwt>`)

3. Sandbox-agent JWT minting no longer uses Redis token cache.

- token is minted fresh on each request
- claim set includes `jti`

4. Outbox callback credentials are not persisted in event rows.

- manager auth headers are injected at dispatch time
- persisted callback event headers are non-sensitive (for example `content-type`)

5. Secret domain split is enforced in manager env.

- separate `USER_JWT_SECRET`, `SANDBOX_SIGNING_SECRET`, `SANDBOX_TOKEN_ENCRYPTION_SECRET`

6. Setup sandbox owner checks now gate key runtime operations.

- setup terminal connect, setup snapshot, and setup terminate require `session.userId == caller.user.id`

7. Manager app logging redacts sensitive auth/query artifacts in structured metadata strings.

### 2.2 Partially Addressed

1. Replay resistance improved but not enforced.

- `jti` exists
- runtime does not track used/revoked JTIs

2. API-key auth surface is narrower but still high-impact if leaked.

- `sessionAuth` API key only allows `PUT /session/:id`
- `agentAuth` API key still allows `/agents/:agentId/*` and guarded `POST /agents` with `parentAgentId`

3. CORS/origin controls are explicit, but effective security still depends on strict origin-list hygiene.

### 2.3 Open

1. OpenVSCode/noVNC still use query credential transport (`tkn`, `password`).
2. Sandbox JWT verification does not enforce `iss`/`aud`.
3. Sandbox runtime still receives high-value static secrets in env.
4. No explicit route-level auth abuse controls/rate-limits are present in these auth paths.

## 3. Current Key Findings (Prioritized)

## P1

### 1. Query credential transport remains for OpenVSCode/noVNC

Where:

- `agent-manager/src/services/sandbox.service.ts` (`buildModalSandboxAccessUrls`)

Behavior:

- OpenVSCode URL includes `?tkn=<sandboxAccessToken>`
- noVNC URL includes `?password=<sandboxAccessToken>`

Risk:

- URL credentials can leak through browser history, referrers, reverse-proxy logs, telemetry, and support tooling
- credential lifetime is longer than ephemeral runtime JWTs

Hardening:

1. Replace query credentials with one-time launch tickets.
2. Keep ticket TTL short (for example <= 60 seconds) and single-use.
3. Enforce ingress/query redaction for `tkn` and `password` until removed.

### 2. High-value secret concentration inside sandbox process

Where:

- `agent-manager/src/services/sandbox.service.ts` (`createAgentSandboxModal`, `createSetupSandbox`)

Behavior:

- runtime receives `SECRET_SEED`
- runtime receives `AGENT_INTERNAL_AUTH_SECRET`
- runtime flow may inject provider API keys via Modal secret object

Risk:

- sandbox compromise can enable runtime token minting potential and manager callback abuse
- static manager API key is reusable deployment credential

Hardening:

1. Replace static callback credential with scoped short-lived credential.
2. Rotate callback credentials per sandbox and revoke on termination.
3. Minimize provider secret injection by workload profile.
4. Add egress restrictions so sandbox can only call required manager endpoints.

### 3. Deployment-wide API key is still a single shared secret

Where:

- `agent-manager/src/middleware/agent-auth.ts`
- `agent-manager/src/middleware/session-auth.ts`
- `agent-go/internal/server/outbox.go`

Risk:

- any leak enables privileged manager operations on known agent/session paths
- no built-in expiry, key id, or principal-level revocation boundary

Hardening:

1. Replace global key with scoped credentials (sandbox-bound or agent-bound) + expiry.
2. Include key id/principal logging for API-key-authenticated requests.
3. Add revocation and rotation procedures with test coverage.

## P2

### 4. Replay controls remain incomplete

Where:

- manager mints `jti` in sandbox-agent JWT
- runtime verifies signature/claims but does not track JTI reuse

Risk:

- intercepted token is replayable until expiry

Hardening:

1. Add replay cache keyed by `jti` for sensitive runtime endpoints.
2. Lower default auth TTLs where acceptable.
3. Add targeted revocation path for high-risk events.

### 5. Missing explicit `iss`/`aud` checks for sandbox-agent JWTs

Where:

- `agent-go/internal/server/serve.go` `requireAuth`

Behavior:

- validates `sid`, `typ`, `agentId`, `sub`, signature, time claims
- does not validate `iss` or `aud`

Risk:

- weaker anti-mixup protection as auth surfaces evolve

Hardening:

1. Add fixed `iss`/`aud` in manager minting.
2. Enforce `iss`/`aud` in runtime verification.

### 6. Explicit auth abuse controls are not present in these paths

Risk:

- brute-force/flooding pressure on login/refresh/token-connect routes

Hardening:

1. Add rate limits and backoff on `/auth/*`, `/agents/:id/access`, `/terminal/connect`.
2. Add per-agent/per-user quota controls for connection/token issuance paths.
3. Alert on unusual auth failure and token-mint spikes.

## P3

### 7. Log redaction is improved in app code but still depends on infra pipeline behavior

Current behavior:

- manager `log.ts` redacts sensitive auth/query artifacts
- frontend terminal logging redacts known websocket query fields before client logs
- ingress/proxy/observability storage redaction still must be enforced separately

Risk:

- raw request metadata in infra layers may still capture sensitive query artifacts

Hardening:

1. Enforce ingress-level redaction for `tkn`, `password`, `_modal_connect_token`.
2. Mark auth headers/query fields as secrets in observability tooling.
3. Reduce retention on raw request metadata.

### 8. Setup sandbox session map is in-memory only

Where:

- `agent-manager/src/services/sandbox.service.ts` (`IMAGE_SETUP_SANDBOXES`)

Risk:

- manager restart can desynchronize control-plane view of setup sandbox ownership/session state

Hardening:

1. Persist setup sandbox session ownership metadata if restart continuity is required.
2. Add startup reconciliation/cleanup for stale setup sessions.

## 4. Single-Tenant Policy Notes (Not Treated as Security Findings)

The following are currently consistent with stated single-tenant/no-role operation and are not prioritized as vulnerabilities in this review:

1. Image read guard is effectively permissive (`ensureCanReadImage` no-op).
2. Image variant access check is effectively permissive (`canUserAccessImageVariant` returns `true`).
3. Agent/session listing and agent access routes are not owner-scoped by default.

Recommendation:

- keep this policy explicit in docs/config so any future multi-tenant transition does not inherit accidental permissive defaults.

## 5. Current Positive Controls (Keep)

1. Secret domain separation is explicit and enforced.
2. Refresh token confidentiality improved (cookie-only).
3. Runtime auth removed query-string token transport for runtime APIs.
4. Token derivation is per-`sid`, limiting cross-session token portability.
5. Runtime enforces `agentId == AGENT_ID`, preventing cross-agent token reuse.
6. Session sync API-key path derives `createdBy` server-side in `PUT /session/:id` upsert route.
7. Setup sandbox runtime operations now have owner checks.

## 6. Recommended Execution Plan

## Phase 1 (immediate)

1. Enforce ingress/app query redaction for OpenVSCode/noVNC credential params.
2. Add auth-path rate limits (`/auth/*`, `/agents/:id/access`, `/terminal/connect`).
3. Explicitly document single-tenant shared-visibility policy and add a migration note for future multi-tenant/role-based mode.

## Phase 2 (near-term)

1. Introduce one-time launch tickets for OpenVSCode/noVNC and retire static query credentials.
2. Add `iss`/`aud` claims and runtime enforcement for sandbox-agent JWTs.
3. Add replay mitigation keyed by `jti` for sensitive runtime routes.

## Phase 3 (defense in depth)

1. Replace deployment-global API key with scoped short-lived callback credentials.
2. Reduce sandbox secret footprint and add egress policy controls.
3. Persist setup session ownership metadata if restart continuity is needed.

## 7. Validation Checklist

1. Refresh token never appears in frontend storage.
2. Runtime API auth succeeds via header/subprotocol and fails via query token.
3. Event storage contains no injected manager auth secrets for callback events.
4. OpenVSCode/noVNC credential query params are redacted in app and ingress logs.
5. Setup sandbox runtime operations by non-owner are blocked.
6. Replay attempts with same token are blocked where replay defense is enabled.
7. `iss`/`aud` mismatch tokens are rejected once claim enforcement is implemented.
8. Single-tenant permissive-visibility policy is explicitly documented with a clear future multi-tenant hardening path.
