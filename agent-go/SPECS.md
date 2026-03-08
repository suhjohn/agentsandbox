# agent-go Full Migration Spec

## 1. Objective

`agent-go` must replace the legacy Bun server (now removed) with behaviorally equivalent Go implementations for:

- HTTP APIs (`/health`, `/openapi.json`, `/session/*`, `/workspaces/*`)
- SSE streams (session, run, workspace diff)
- terminal websocket endpoint (`/terminal`)
- SQLite persistence + schema evolution behavior
- Codex harness execution semantics
- PI harness execution semantics
- manager-sync event outbox behavior

No backward-compat shims are required beyond matching current server behavior.

## 2. Sources of Truth

### 2.1 Local code contracts

- Agent server implementation:
  - `agent-go/internal/server/*`
  - `agent-go/internal/store/*`
  - `agent-go/internal/session/*`
  - `agent-go/internal/workspace/*`
  - `agent-go/internal/terminal/*`
- Canonical OpenAPI contract (used for client generation):
  - `agent-go/internal/openapi/openapi.json`

### 2.2 Codex CLI derivation inputs

Derived from local installed CLI help outputs (`codex --help` and all subcommand `--help` pages) on 2026-02-26.

### 2.3 PI derivation inputs

- Local docs in repo: `PI_AGENT_DOCS.md`
- Upstream PI docs:
  - `https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/README.md`
  - `https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/docs/rpc.md`

### 2.4 Man pages

- `man codex`: unavailable in current environment
- `man pi`: unavailable in current environment

Implementation must rely on CLI help + upstream docs when manpages do not exist.

## 3. API Parity Requirements

## 3.1 Required HTTP routes

Must match method/path/status semantics from Bun:

- `GET /health`
- `GET /openapi.json`
- `POST /session`
- `GET /session`
- `GET /session/:id`
- `POST /session/:id/message`
- `GET /session/:id/stream`
- `GET /session/:id/message/:runId/stream`
- `POST /session/:id/stop`
- `DELETE /session/:id`
- `GET /workspaces`
- `GET /workspaces/:name/diff`
- `GET /workspaces/:name/diff/stream`
- `GET /workspaces/:name/diff/file-contents`

## 3.2 Error payload shape

All API errors must return:

```json
{ "error": "...", "status": 400 }
```

with matching status code.

## 3.3 CORS behavior

Allow:

- origins:
  - `${AGENT_MANAGER_BASE_URL}` origin (scheme+host) when set
  - `http://localhost:5173`, `http://localhost:5174` only when `${AGENT_MANAGER_BASE_URL}` is localhost (dev)
- headers: `Content-Type, X-Agent-Auth`
- methods: `GET, POST, PATCH, DELETE, OPTIONS`

If a request includes an `Origin` header and it is not allowlisted, respond with `403 Forbidden`.

## 3.4 OpenAPI endpoint

`GET /openapi.json` must expose an OpenAPI equivalent to `agent-go/internal/openapi/openapi.json` route coverage and schema shape.

## 4. Auth Contract

## 4.1 Header and token

- header: `X-Agent-Auth: Bearer <jwt>`
- JWT must carry:
  - `typ="sandbox-agent"`
  - `sid`
  - `sub` (non-empty for all protected routes)
  - `agentId` (must match `AGENT_ID`)
- secret derivation:
  - `HMAC_SHA256(SECRET_SEED, "sandbox-agent:<sid>")` hex digest used as HS256 secret

## 4.2 Behavior

- missing/invalid token => `401 Unauthorized`
- `sid` mismatch between unverified payload and verified payload => `401`
- endpoints needing user attribution must require non-empty `sub`

## 5. Session Domain + SQLite

## 5.1 Tables and columns

Match Bun schema:

- `sessions`
  - `id` (BLOB PK, hex session id)
  - `agent_id`
  - `created_by`
  - `status`
  - `harness`
  - `external_session_id`
  - `title`
  - `first_user_message_body`
  - `last_message_body`
  - `model`
  - `model_reasoning_effort`
  - `created_at`
  - `updated_at`
- `messages`
  - `id` (BLOB PK)
  - `agent_id`
  - `session_id` (TEXT hex)
  - `turn_id`
  - `created_by`
  - `body` (JSON text)
  - `embeddings`
  - `created_at`
- `events` (outbox)

## 5.2 Session semantics

- Session ID format: 32-hex
- `POST /session` creates or returns existing session
- Existing session harness change (`codex` <-> `pi`) with same id => `409`
- Default `agentId=default`, `status=initial`, `harness=codex`
- Empty/default model or reasoning selections are materialized into `sessions.model` and `sessions.model_reasoning_effort` using configured runtime defaults instead of being stored as `NULL`

## 5.3 Message semantics

On create message:

- persist `body` JSON
- update `updated_at`
- update `first_user_message_body` only first time for `type=user_input`
- update `last_message_body` only when body qualifies as “last-message candidate” (same candidate rules as Bun)

## 5.4 Turn ID semantics

- new user_input starts a turn id
- subsequent assistant/tool events for same turn keep the same turn id

## 6. Run Lifecycle + SSE

## 6.1 Start run contract

`POST /session/:id/message`:

- validates input schema (`text`, `local_image`, `image(data URL)`)
- normalizes `image` into local file path
- updates session model defaults using requested values when present, otherwise configured runtime defaults
- rejects concurrent run with `409`
- returns `{ success, sessionId, runId, threadId? | sessionFile? }`

## 6.2 Session stream contract

`GET /session/:id/stream` sends:

- `connected`
- backfill message events from DB
- `status` with `isRunning`
- periodic `ping`
- live message/status/error events

## 6.3 Run stream contract

`GET /session/:id/message/:runId/stream`:

- stream from buffered/live run events
- support reconnect before TTL expiration
- periodic `ping`
- `404` for unknown run or run/session mismatch

## 6.4 Stop contract

`POST /session/:id/stop`:

- no active run => `{success:false, message:"No active run to stop"}`
- active run => abort, session status reset, emit `stopped`, return success

## 7. Workspaces API Contract

## 7.1 Listing

`GET /workspaces`:

- validate auth
- list workspace directories under resolved workspaces root
- include `isGitRepo`
- optional `status` if `includeStatus=true`

## 7.2 Diff endpoint

`GET /workspaces/:name/diff`:

- validate workspace name/path traversal rules
- supports `basis=repo_head|baseline`
- supports `maxChars`, `includePatch`
- returns status + patch + truncation markers

## 7.3 Diff stream endpoint

`GET /workspaces/:name/diff/stream`:

- SSE events: `meta`, `status`, `baseline?`, repeated `file`, `done`, `ping`
- event ordering must match Bun behavior

## 7.4 File contents endpoint

`GET /workspaces/:name/diff/file-contents`:

- supports kind set:
  - repo-head kinds: `unstaged|staged|untracked`
  - baseline kinds: `baseline-tracked|baseline-untracked`
- invalid kind/basis combos => `400`
- returns `{oldFile, newFile}`

## 8. Terminal WebSocket Contract

`/terminal` websocket parity:

- shell bootstrap command equivalent:
  - start interactive bash at default working directory
- support resize messages `{type:"resize",cols,rows}`
- stream terminal data frames
- keepalive frame behavior
- graceful close + process cleanup

## 9. Codex Go Wrapper Spec (`codex.go`)

## 9.1 Derivation comment requirement

`codex.go` must begin with a top comment that states:

- command/flag derivation sources (`codex --help` + subcommand help + docs URL)
- capture date
- note that `man codex` unavailable in this environment

## 9.2 Design constraints

- ergonomic and simple API
- thin wrapper over CLI execution (no speculative protocol)
- typed options for high-usage commands
- deterministic argv builders
- minimal validation
- context cancellation for subprocess lifetime

## 9.3 Required command coverage

Support wrappers for:

- root interactive invocation
- `exec` (+ `resume`, `review`)
- `review`
- `resume`, `fork`
- `mcp` (`list/get/add/remove/login/logout`)
- `mcp-server`
- `completion`
- `sandbox` (pass-through)
- `login`, `logout`
- `apply`
- `features` (`list/enable/disable`)
- `cloud` (`exec/status/list/apply/diff`)
- `app-server` + generators
- `debug app-server send-message-v2`

## 9.4 Streaming expectations

For non-interactive execution:

- support JSONL/event stream consumption when `--json` enabled
- preserve stdout/stderr separation
- expose exit status + structured error

## 10. PI Go Wrapper Spec (`pi.go`)

## 10.1 Derivation comment requirement

`pi.go` top comment must cite:

- PI README CLI reference URL
- PI RPC docs URL
- local `PI_AGENT_DOCS.md`
- note that local `pi --help` and `man pi` were unavailable in this env

## 10.2 Required CLI coverage

At minimum support wrappers for:

- interactive/default mode
- print mode (`-p/--print`)
- JSON mode (`--mode json`)
- RPC mode (`--mode rpc`)
- session options (`-c`, `-r`, `--session`, `--session-dir`, `--no-session`)
- provider/model/thinking/options listed in upstream CLI reference
- tools/resources toggles (`--tools`, `--no-tools`, extensions/skills/themes/prompt flags)
- package commands (`install/remove/update/list/config`)

## 10.3 RPC helpers

Provide optional helpers for key RPC commands:

- `prompt`, `steer`, `follow_up`, `abort`
- `get_state`, `get_messages`
- model and thinking controls
- session/fork/export helpers

Parser should treat stdin/stdout as JSONL command/event stream.

## 11. Manager Sync / Outbox

Parity for event dispatch behavior:

- queue HTTP events in SQLite `events`
- background dispatcher polls/dispatches batch
- exponential retry/backoff and status transitions
- startup requeues `processing` events to `pending`

Manager sync calls:

- `PUT {AGENT_MANAGER_BASE_URL}/session/:id`
- `POST {AGENT_MANAGER_BASE_URL}/agents/:agentId/snapshot`

auth preference:

- `x-agent-manager-api-key` first
- otherwise bearer auth token

## 12. Environment Variable Contract

Must preserve effective behavior for these:

- core: `PORT`, `DATABASE_PATH`, `SECRET_SEED`, `DEFAULT_MODEL`, `DEFAULT_REASONING_EFFORT`, `DEFAULT_WORKING_DIR`
- codex: `OPENAI_API_KEY`, `CODEX_API_KEY`, `CODEX_EXECUTABLE_PATH`, `CODEX_PATH`
- pi: `PI_CODING_AGENT_DIR`
- paths/runtime: `AGENT_HOME`, `ROOT_DIR`, `WORKSPACES_DIR`
- manager sync: `AGENT_MANAGER_BASE_URL`, `AGENT_MANAGER_API_KEY`, `AGENT_MANAGER_AUTH_TOKEN`

## 13. Testing and Acceptance

## 13.1 Mandatory tests

- black-box API tests for session create/message create/stream/stop/delete
- auth-negative tests (missing/invalid tokens)
- workspace diff and file-contents tests
- SSE reconnect/run-buffer tests
- SQLite persistence assertions
- codex wrapper argv tests (table-driven)
- pi wrapper argv + rpc parsing tests

## 13.2 Parity gate

Migration is complete only when:

1. `agent-go` server passes route behavior parity tests against Bun baseline.
2. existing integration tests are green or migrated equivalents are green.
3. codex/pi wrappers are used in runtime path, not bypassed shell ad-hoc logic.

## 14. Migration Phases

1. Buildable skeleton + DB/auth/health/session CRUD
2. SSE run/session lifecycle parity
3. Workspaces parity
4. Terminal websocket parity
5. `codex.go` + `pi.go` wrappers + runtime wiring
6. outbox/sync parity
7. full black-box parity test pass

## 15. Explicit Non-Goals

- Introducing new APIs not present in Bun server
- Refactoring behavior to "improve" semantics during migration
- Changing auth/token formats
- Adding compatibility for deprecated schema variants beyond existing Bun migration behavior
