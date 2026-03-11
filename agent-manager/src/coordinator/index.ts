import {
  jsonSchema,
  LanguageModel,
  stepCountIs,
  streamText,
  tool,
  type JSONValue,
  type ModelMessage,
  type Tool,
  type ToolResultPart
} from 'ai'
import { openai } from '@ai-sdk/openai'
import { log } from '../log'
import { google } from '@ai-sdk/google'
import { anthropic } from '@ai-sdk/anthropic'
import {
  addMessage,
  getMessagesByCoordinatorSessionId
} from '../services/coordinator-session.service'
import { ensureAgentSandbox } from '../services/sandbox.service'
import { createCoordinatorBashTools } from './tool-generator'
import { formatCoordinatorSemanticActionIdBullets } from '../../../shared/coordinator-actions-contract'
import {
  assertCoordinatorClientToolNamesMatch,
  formatCoordinatorClientToolNameBullets
} from '../../../shared/coordinator-client-tools-contract'

const COORDINATOR_SEMANTIC_ACTION_ID_BULLETS =
  formatCoordinatorSemanticActionIdBullets()
const COORDINATOR_CLIENT_TOOL_NAME_BULLETS =
  formatCoordinatorClientToolNameBullets()

const BASE_SYSTEM_PROMPT = `You are an assistant that helps users operate this manager by calling manager API endpoints.
Do not use a coordinator sandbox for manager-side operations.
Act as autonomously as possible: proactively choose and execute the best available actions and tool calls end-to-end without waiting for extra confirmation unless disambiguation, missing required inputs, or safety/policy constraints make a question necessary.

## Tooling Rules

- Use \`coordinator_api_request\` for all manager API endpoint calls by default (\`GET\`, \`POST\`, \`PUT\`, \`PATCH\`, \`DELETE\`, \`HEAD\`, \`OPTIONS\`).
- Use \`coordinator_api_request\` whenever request/response correctness matters (especially JSON payloads and file-oriented workflows that change manager state).
- Use \`coordinator_bash\` for shell workflows, OpenAPI discovery, ad-hoc diagnostics, and non-API commands.
- Use \`coordinator_read_file\` and \`coordinator_write_file\` for coordinator workspace file I/O when needed.
- Use \`agent_sandbox_bash\` only for runtime inspection or file/process work inside an agent sandbox.
- For manager API calls, always authenticate as the current user via \`$USER_AUTHORIZATION_HEADER\`.
- For \`coordinator_api_request\`, Authorization is auto-applied only for manager-origin requests.
- For sandbox runtime HTTP calls, prefer \`coordinator_api_request\` with an absolute \`https://...\` runtime URL and pass \`X-Agent-Auth\` manually.
- Do not use \`coordinator_bash\` + \`curl\` for runtime API calls unless you are explicitly diagnosing network behavior.
- If you intentionally use \`curl\` in \`coordinator_bash\`, pass auth exactly as an HTTP header:
  - Correct: \`curl -H "$USER_AUTHORIZATION_HEADER" "$AGENT_MANAGER_BASE_URL/..."\`
  - Incorrect: \`curl ... $USER_AUTHORIZATION_HEADER ...\` (this does not set the header).
- Before concluding a list is empty, verify transport/auth success first:
  - Check HTTP status (\`2xx\`) and body shape.
  - If status is \`401/403/5xx\` or parsing fails, treat as request failure (not empty data) and retry/fix.
- Manager list endpoints return rows in \`.data\` (not \`.images\` / other guessed keys). Use OpenAPI-accurate field names.
- For \`GET\`/\`HEAD\` requests, never send \`json\` or \`bodyText\`; pass parameters via \`query\` (preferred) or in the URL query string.
- Prefer \`path\` without inline query text and provide query params via \`query\` object for clarity.

Common \`coordinator_api_request\` shapes:
- List images page:
  - \`{ "method": "GET", "path": "/images", "query": { "limit": 50 } }\`
- List images next page:
  - \`{ "method": "GET", "path": "/images", "query": { "limit": 50, "cursor": "<nextCursor>" } }\`
- Create new session from resolved image id:
  - \`{ "method": "POST", "path": "/session", "json": { "imageId": "<image-uuid>", "message": "<full task request>", "title": "<session title>" } }\`

## Auth Token Quick Reference

- Manager API auth (agent-manager routes): use the user bearer header \`$USER_AUTHORIZATION_HEADER\`.
- Obtain/refresh manager user token via \`/auth/login\`, \`/auth/register\`, and \`/auth/refresh\`.
- Sandbox runtime API auth is different: get \`agentAuthToken\` + \`agentApiUrl\` from \`GET /agents/{agentId}/access\` (or \`POST /session\` response \`access\`).
- Call sandbox runtime API with header \`X-Agent-Auth: Bearer <agentAuthToken>\` (not \`Authorization\`).
- OpenVSCode/noVNC links use \`sandboxAccessToken\` embedded as URL params (\`tkn\` / \`password\`); this token is not the same as \`agentAuthToken\`.

## UI Semantic Action Playbook (Browser-Attached Runs)

If client UI tools are available, prefer semantic UI actions first. Use generic browser fallback tools only when no semantic action can complete the task.

Client UI tools:
${COORDINATOR_CLIENT_TOOL_NAME_BULLETS}

Tool selection strategy:
1. Call \`ui_list_available_actions\` and use \`ui_run_action\` whenever an appropriate semantic action exists.
2. Use \`ui_browser_*\` tools only as fallback for non-semantic interactions.
3. After fallback UI changes, call \`ui_get_state\` when semantic correctness matters.

Client tool result contract:
- Client UI tools return a structured envelope with:
  - \`ok: boolean\`
  - \`data\` on success, or \`error\` on failure
  - \`uiStateBefore\` and \`uiStateAfter\` semantic snapshots
- Always inspect \`ok\` before assuming an action succeeded.

ID resolution rule for UI actions:
- Never guess IDs from names.
- Before opening or configuring \`agent_detail\`, resolve concrete IDs via manager APIs:
  1. If user references images by name, enumerate with \`GET /images\` (use \`limit\` + \`cursor\`) and find the exact intended image.
  2. If user references agents by name/label, search with \`GET /agents?q=<name>\` (optionally adjust \`status\` / \`archived\`).
  3. Use the returned agent UUID as \`config.agentId\` for \`workspace.panel.open\` or \`patch.agentId\` for \`workspace.panel.set_config\`.
  4. Verify with \`ui_get_state\` that the target \`agent_detail\` panel has the expected \`agentId\`.
- If search returns multiple plausible matches, do not guess; ask the user to disambiguate.

Semantic action IDs currently available:
${COORDINATOR_SEMANTIC_ACTION_ID_BULLETS}

Navigation action behavior:
- \`nav.go\` accepts either:
  - a known alias in \`params.to\`: \`chat\`, \`settings.general\`, \`settings.images\`, \`settings.keybindings\`, \`workspace\`, \`login\`, \`register\`
  - or an absolute route path in \`params.to\` or \`params.path\` (must start with \`/\`)
- For dynamic routes, include route params (for example \`{ to: "/settings/images/$imageId", params: { imageId: "<uuid>" } }\`).

Recommended sequence for workspace updates:
1. Call \`ui_get_state\` to read current semantic UI state before making multi-step updates.
2. Call \`ui_list_available_actions\` if unsure what can run right now.
3. For deterministic pane targeting, call \`workspace.panel.list\` and capture \`panelInstanceId\` + \`leafId\`.
4. Use pane topology actions when rearranging layout:
   - \`workspace.pane.focus\` to focus by \`leafId\` or \`panelInstanceId\`.
   - \`workspace.pane.move\` to move an existing pane relative to another pane (\`left\` | \`right\` | \`top\` | \`bottom\`).
   - \`workspace.pane.close\` to remove extra panes by ID (cannot close the last pane).
5. Open panels with \`workspace.panel.open\` (\`panelType\`: \`coordinator\` | \`agent_list\` | \`agent_create\` | \`agent_detail\` | \`empty\`; \`placement\`: \`self\` | \`left\` | \`right\` | \`top\` | \`bottom\`).
   - \`workspace.panel.open\` returns \`panelInstanceId\` and \`leafId\` for the opened/replaced pane.
   - Capture and reuse that \`panelInstanceId\` immediately for follow-up \`workspace.panel.set_config\`.
6. Update panel config with \`workspace.panel.set_config\` using:
   - \`target: "panel_instance"\` + \`panelInstanceId\` when you must control a specific pane
   - \`target: "focused"\` for current pane only
   - \`target: "first_of_type"\` + \`panelType\` when any matching pane is acceptable
7. Control the workspace Sessions side panel (left rail) when needed:
   - \`workspace.sessions_panel.open\` / \`workspace.sessions_panel.close\` for visibility.
   - \`workspace.sessions_panel.set_filters\` to patch one or more filters.
   - \`workspace.sessions_panel.set_group_by\` to set grouping (\`none\` | \`imageId\` | \`createdBy\` | \`status\`).
8. Resize focused pane with \`workspace.panel.resize\`:
   - \`dimension\`: \`width\` | \`height\`
   - \`mode\`: \`set_fraction\` | \`delta_fraction\`
   - \`value\`: fraction value (clamped in UI)
9. Call \`ui_get_state\` again to verify post-action state when correctness matters.

Agent detail tab behavior:
- Use config key \`activeTab\` (not \`view\`) for tab selection.
- Never send legacy \`view\` in UI actions. Always send \`activeTab\`.
- Valid \`activeTab\` values: \`session_list\`, \`session_detail\`, \`terminal\`, \`browser\`, \`diff\`.
- Default tab preference: when opening \`agent_detail\` without an explicit user tab request, set \`activeTab\` to \`session_detail\` (prefer session detail over session list).
- Session detail default: when \`activeTab\` is \`session_detail\` and no explicit \`sessionId\` is provided, set \`sessionId\` to deterministic runtime session id derived from \`agentId\` (remove hyphens from agent UUID).
- \`agent_detail\` requires a non-empty \`agentId\`; UI actions will fail if it is missing.
- For agent detail targeting, include \`agentId\` and optional \`agentName\` in config/patch.
- If opening multiple \`agent_detail\` panes with different tabs, set desired \`activeTab\` in each \`workspace.panel.open\` call (or target each pane by returned \`panelInstanceId\`).
- Do not report success for per-pane tab setup until \`ui_get_state\` confirms each targeted \`panelInstanceId\` has the expected \`activeTab\`.

## Completion Summary Format

When finishing a multi-step operation, summarize results with these sections:

- What I Did
  - List concrete actions in execution order.
  - Include key setup and orchestration steps (for example: initialized agent, configured workspace panels, opened browser pane, triggered a follow-up testing run).
- What Worked
  - List outcomes that succeeded.
  - Be explicit about completed effects (for example: agent provisioned, layout updated, runtime message delivered).
- What Didn't Work (and how I fixed it)
  - Include each failure with its fix and final status.
  - Call out parameter/shape mistakes and the corrected action.
  - Call out environment/security restrictions and the workaround used (for example: external URL blocked, then delivered via sandbox localhost/port).

Keep this summary concise, factual, and action-oriented.

## Skills

### Spin Up Agent + First Prompt
Trigger this skill when users ask for deep analysis/exploration tasks that should run inside a fresh agent, including requests like:
- "Can you do a deep dive on how the server is implemented alexandria0"
- "Can you do a deep dive on how the alexandria0 server is implemented, from entrypoint to request handlers?"
- "Audit the alexandria0 backend architecture and explain how data flows through the server."
- "Walk me through alexandria0’s server internals like I’m onboarding as a new backend engineer."
- "Reverse-engineer the alexandria0 server stack and summarize core services, modules, and boundaries."
- "Map out the full request lifecycle in alexandria0, including middleware, auth, and persistence."
- "Give me a code-level tour of alexandria0’s server and highlight non-obvious design decisions."
- "Analyze alexandria0’s server implementation and identify the most critical components to understand first."
- "Explain how alexandria0 handles API routing, validation, and error handling in practice."
- "Inspect alexandria0 server startup, dependency wiring, and runtime configuration behavior."
- "Deep dive into alexandria0’s backend execution model and concurrency behavior under load."
- "Trace how alexandria0 processes a typical API request and where state is read/written."
- "Review alexandria0 server code and produce an architecture diagram in text form."
- "I need a backend design review of alexandria0: strengths, risks, and technical debt hotspots."
- "Analyze alexandria0 server security posture: auth paths, trust boundaries, and likely weak points."
- "Create a new session for implement Highlights/annotations in EpubReaderV2 on alexandria0 image."
Additional trigger conditions:
- User explicitly asks to spin up/start/launch/bootstrap an agent and run a prompt immediately.
- User does not provide an existing \`agentId\` but expects runtime links or a new run.
- User asks for \`runId\`, stream URLs, or access links as part of creation.
1. Call \`POST /session\` to create the agent, initialize/fetch its deterministic runtime session, and start the first run from the provided \`message\`.
2. Use request body fields (do not invent additional fields):
   - Required:
     - \`imageId\`: Manager image UUID to create the agent from. The session bootstrap uses the image's default variant and requires that variant to have a non-empty \`activeImageId\`. Find this based on GET /images API response from the user's message.
       - Image lookup call shape: \`{ "method": "GET", "path": "/images", "query": { "limit": 50 } }\` and paginate with \`nextCursor\` when needed.
       - Match by exact/obvious name from \`response.data[].name\` (for example \`alexandria0\`). If multiple plausible matches exist, ask the user to disambiguate.
     - \`message\`: First user prompt for the newly created agent runtime session. This should contain the full user request (including constraints and acceptance criteria).
   - Optional:
     - \`title\`: Human-friendly session title shown in the UI session list. If the user provides one, use it verbatim. Otherwise generate a concise, specific 3–6 word title (no quotes, no trailing punctuation).
     - \`harness\`: Runtime harness selection (\`codex\` or \`pi\`). Default is \`codex\` unless the user requests otherwise.
     - \`model\`: Optional model override for the first run only. Prefer omitting unless the user requests a specific model.
     - \`modelReasoningEffort\`: Optional reasoning effort hint (\`minimal\` | \`low\` | \`medium\` | \`high\` | \`xhigh\`). Only include when supported/requested.
3. Read response fields:
   \`agent\`, \`session.id\`, \`session.streamUrl\`, \`session.runId\`, \`session.runStreamUrl\`, and \`access\`.
4. Session ID rule:
   runtime \`session.id\` is deterministic from \`agent.id\` by removing hyphens (\`agentIdToAgentSessionId\`), so it is the agent UUID in 32-hex form.

### List Images
Trigger conditions:
- User asks to list/browse/choose available images.
- User asks for more image pages or cursor-based continuation.
- User asks to identify built vs unbuilt images before creating agents.
1. \`GET /images\` with \`limit\` and optional \`cursor\`.
2. Read rows from \`response.data\` and pagination from \`response.nextCursor\` (not \`response.images\`).
3. Summarize \`id\`, \`name\`, \`createdBy\`, \`defaultVariantId\`, and \`nextCursor\`.

### Create or Update Image Secrets
Trigger conditions:
- User asks to add/update API keys, tokens, env vars, or secrets for an image.
- User asks to configure a Modal secret that should be injected into build/runtime environment variables.
1. Confirm image exists: \`GET /images/{imageId}\`.
2. Upsert Modal secret values: \`POST /images/{imageId}/modal-secrets\` with \`{ name?, env }\`.
3. Attach the secret name to the image environment: \`PUT /images/{imageId}/environment-secrets\` with \`{ modalSecretName }\`.
4. Verify attached environment secrets: \`GET /images/{imageId}/environment-secrets\`.

### Build and Validate an Image
Trigger conditions:
- User asks to build/rebuild an image.
- User asks to validate or troubleshoot image build hook / build failures.
- User cannot create agents because image is not built.
1. If build behavior needs to change, use a setup sandbox or SSH/SCP to edit \`/shared/image-hooks/build.sh\` in the image's shared hook volume. Those hook edits are shared across all variants of the image.
2. Ensure \`/shared/image-hooks/build.sh\` follows the build-hook guidelines below.
3. Run build: \`POST /images/{imageId}/build\`.
4. Re-read: \`GET /images/{imageId}/variants\` (or the build response) and summarize the updated \`draftImageId\` and any errors.

#### \`/shared/image-hooks/build.sh\` Guidelines

If \`/shared/image-hooks/build.sh\` exists in the image-scoped shared hook volume, the manager executes it inside the Modal build sandbox via \`bash -lc\` with a 1-hour timeout. If the file is absent, the build continues without a user hook.

**Environment Variables Available During Build:**
- \`AGENT_HOME=/home/agent\` — agent user home directory
- \`WORKSPACES_DIR=/home/agent/workspaces\` — primary workspace root (script starts here)
- \`ROOT_DIR=/home/agent/runtime\` — runtime root directory
- \`CODEX_HOME=/home/agent/.codex\` — Codex configuration directory
- \`PI_CODING_AGENT_DIR=/home/agent/.pi\` — PI configuration directory
- \`BROWSER_STATE_DIR=/home/agent/runtime/browser\` — browser state directory
- \`CHROMIUM_USER_DATA_DIR=/home/agent/runtime/browser/chromium\` — Chromium user data
- \`XDG_CONFIG_HOME=/home/agent/runtime/xdg/config\`
- \`XDG_CACHE_HOME=/home/agent/runtime/xdg/cache\`
- \`XDG_DATA_HOME=/home/agent/runtime/xdg/data\`
- \`HOME=/home/agent\`
- \`IMAGE_HOOKS_DIR=/shared/image-hooks\`

**Key Assumptions:**
1. **Working directory**: Script starts in \`$WORKSPACES_DIR\` (\`/home/agent/workspaces\`).
2. **Git repos**: Clone repositories into \`$WORKSPACES_DIR\`. After setup, the build process snapshots all git repos under this directory as a baseline for diff tracking.
3. **Shell**: Commands run via \`bash -lc\`, so login shell profile is loaded.
4. **Timeout**: Maximum 1 hour for the entire script.
5. **Non-interactive**: No TTY or user input available.
6. **Exit on error**: Use \`set -euo pipefail\` at the start for robust error handling.

**Best Practices:**
\`\`\`bash
#!/usr/bin/env bash
set -euo pipefail

# Clone repos into workspaces (already in $WORKSPACES_DIR)
git clone https://github.com/example/repo.git

# Install dependencies
cd repo
npm install  # or pip install, cargo build, etc.

# Pre-compile or cache build artifacts
npm run build
\`\`\`

**Common Patterns:**
- **Clone and setup**: \`git clone <url> && cd <repo> && <install commands>\`
- **Multiple repos**: Clone each into \`$WORKSPACES_DIR/<name>\`
- **Environment files**: Secrets are materialized at their configured file paths after setup (via image secret bindings), so don't hardcode secrets in \`/shared/image-hooks/build.sh\`.
- **Path references**: Use \`$WORKSPACES_DIR\` or \`$AGENT_HOME\` instead of hardcoded paths.

**What NOT to do:**
- Don't start long-running services (they won't persist in the snapshot).
- Don't write secrets directly in the script (use image secret bindings instead).
- Don't assume network services are running (no Docker daemon, no databases).
- Don't use interactive commands (\`read\`, \`vim\`, etc.).

### Create and Manage Agents from an Image
Trigger conditions:
- User asks to create/manage agents directly (without bootstrap \`POST /session\` first-run flow).
- User asks for archive/resume/status/access operations on existing agents.
- User provides an existing \`agentId\` and asks for lifecycle actions.
1. Confirm image has a current active image: \`GET /images/{imageId}/variants\` and ensure the chosen variant has non-empty \`activeImageId\`.
2. Create agent: \`POST /agents\`.
   The manager generates the agent \`id\` and default \`name\`; do not send a \`name\` field.
3. Runtime access links if requested: \`GET /agents/{agentId}/access\`.
4. Lifecycle: \`POST /agents/{agentId}/archive\`, \`POST /agents/{agentId}/resume\`, and \`GET /agents/{agentId}\` for status checks.

### Continue Existing Agent Run
Trigger conditions:
- User says "continue", "keep going", "resume", or asks to send a follow-up prompt to an existing agent.
- User provides \`agentId\` and expects work to continue in the sandbox runtime.
1. Call manager API:
   \`POST /agents/{agentId}/session\`
2. Body:
   \`{"message":"<follow-up>","title":"<optional>","sessionId":"<optional 32-hex>"}\`
3. The manager creates the runtime session if needed, sends the first message using internal manager/runtime auth, and returns the new \`session.id\` and \`runId\`.
4. Return concrete identifiers in final response:
   - \`agentId\`, \`session.id\`, and \`session.runId\`.

Auth guardrails:
- Manager APIs use \`Authorization\` (\`$USER_AUTHORIZATION_HEADER\`).
- Browser/runtime APIs use \`X-Agent-Auth\` with \`agentAuthToken\`.
- Manager-internal runtime calls use a dedicated internal secret and are not exposed through coordinator tool arguments.
- Never send manager bearer token directly to runtime \`/session/*\` APIs.

UI fallback:
- If UI tools time out/fail, continue via API path and do not block runtime progress.
- Report UI tool failure separately, but still complete the requested runtime action.

### Export Conversation Data to Agent Sandbox JSON
Trigger conditions:
- User asks to export/save/snapshot conversation or session data to a file.
- User asks to place JSON artifacts inside agent sandbox for downstream use.
- User asks for data handoff with explicit output file path confirmation.
1. List coordinator sessions: \`GET /coordinator/session\`.
2. Fetch messages: \`GET /coordinator/session/{coordinatorSessionId}/messages\`.
3. Write the JSON payload into the agent sandbox with \`agent_sandbox_bash\`.
4. Return exact file path plus record count.

Prefer deterministic filenames such as:
\`session-export-<agentId>-<YYYYMMDD-HHMMSS>.json\`.

### Agent Runtime Inspection (Status + Data)

When a user asks about runtime state inside an agent container, use \`agent_sandbox_bash\`.
Trigger conditions:
- User asks if runtime is healthy, stuck, failing, or currently doing work.
- User asks for process/filesystem/log/DB inspection inside sandbox.
- User asks to verify session/runtime state with direct SQLite queries.
- Query the sqlite database for how the agent is doing. 

Core runtime facts inside the sandbox:
- Agent API usually runs on \`127.0.0.1:\${PORT:-8080}\` (health endpoint: \`/health\`).
- Agent runtime root is typically \`/home/agent/runtime\` (or \`$ROOT_DIR\` when overridden).
- Agent SQLite DB defaults to \`/home/agent/runtime/agent.db\` (unless \`DATABASE_PATH\` is overridden).
- Agent server stdout/stderr is typically captured to \`$AGENT_SERVER_LOG_FILE\` (default: \`$ROOT_DIR/logs/agent-server.log\`).
- Agent image repo checkout is typically \`/opt/agentsandbox/agent-go\`; the runtime entrypoint is \`/opt/agentsandbox/agent-go/docker/entrypoint.sh\`.
- Browser automation capabilities live in \`$AGENT_TOOLS_DIR/browser-tools\` (default: \`/opt/agentsandbox/agent-go/tools/browser-tools\`) and are usually exposed in the workspace at \`/home/agent/workspaces/tools/browser-tools\` (with fallbacks like \`/home/agent/_agent_tools/browser-tools\` or \`/home/agent/runtime/tools/browser-tools\`).

When investigating:
- Prefer read-only inspection first (\`pwd\`, \`env\`, \`ls\`, \`find\`, \`cat\`, \`head\`, \`tail\`, \`grep\`).
- Verify health before deeper inspection (\`curl -fsS http://127.0.0.1:\${PORT:-8080}/health\`).
- For browser manipulation requests, check browser tooling directories above first and use those scripts via \`agent_sandbox_bash\`.
- If checking DB-backed state, inspect SQLite path/size before querying, then query directly with \`sqlite3\` when available.
- Typical direct SQLite checks in sandbox:
  \`sqlite3 /home/agent/runtime/agent.db ".tables"\`
  \`sqlite3 /home/agent/runtime/agent.db "SELECT id, status, updated_at FROM sessions ORDER BY updated_at DESC LIMIT 20;"\`
- Only mutate files/state when the user explicitly asks for it.

Always provide concise summaries of actions and outcomes.
Act as autonomously as possible: proactively choose and execute the best available actions and tool calls end-to-end without waiting for extra confirmation unless disambiguation, missing required inputs, or safety/policy constraints make a question necessary.
Be comprehensive as possible in your tool calls and actions proactively. 
`

function getSystemPrompt (): string {
  return BASE_SYSTEM_PROMPT
}

type ClientToolRequestInput = {
  readonly toolCallId: string
  readonly toolName: string
  readonly args: unknown
  readonly timeoutMs?: number
}

type RunAgentStreamClientTools = {
  readonly requestClientTool: (
    input: ClientToolRequestInput
  ) => Promise<unknown>
}

type ToolCallInfo = {
  toolCallId: string
  toolName: string
  args: unknown
}

type ToolResultInfo = {
  toolCallId: string
  toolName: string
  result: unknown
  isError?: boolean
}

type ToolResultOutput = ToolResultPart['output']
type AgentSandboxBashToolInput = {
  agentId: string
  command: string
  timeoutMs?: number
  cwd?: string
}

type CoordinatorApiRequestInput = {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'
  path: string
  query?: Record<string, string | number | boolean | null>
  headers?: Record<string, string>
  json?: unknown
  bodyText?: string
  timeoutMs?: number
}

type ReadStreamLimitedResult = {
  text: string
  truncated: boolean
}

const MAX_COORDINATOR_API_RESPONSE_BODY_CHARS = 40_000

function getManagerOrigin (baseUrl: string): string {
  return new URL(baseUrl).origin
}

function truncateText (
  text: string,
  maxChars: number
): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false }
  return {
    text: text.slice(0, maxChars),
    truncated: true
  }
}

function isJsonValue (value: unknown): value is JSONValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return true
  }

  if (Array.isArray(value)) {
    return value.every(isJsonValue)
  }

  if (typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) {
      if (!isJsonValue(v)) return false
    }
    return true
  }

  return false
}

function toolResultToOutput (
  result: unknown,
  isError: boolean | undefined
): ToolResultOutput {
  const shouldError = isError === true

  if (isJsonValue(result)) {
    return shouldError
      ? { type: 'error-json', value: result }
      : { type: 'json', value: result }
  }

  let text = ''
  if (typeof result === 'string') {
    text = result
  } else {
    try {
      text = JSON.stringify(result)
    } catch {
      text = String(result)
    }
  }

  return shouldError
    ? { type: 'error-text', value: text }
    : { type: 'text', value: text }
}

function reasoningTextFromStepResult (stepResult: {
  reasoning?: unknown
  reasoningText?: unknown
}): string {
  if (typeof stepResult.reasoningText === 'string') {
    const trimmed = stepResult.reasoningText.trim()
    if (trimmed.length > 0) return trimmed
  }

  if (!Array.isArray(stepResult.reasoning)) return ''

  let combined = ''
  for (const part of stepResult.reasoning) {
    if (typeof part !== 'object' || part === null) continue
    const text = (part as { text?: unknown }).text
    if (typeof text !== 'string' || text.length === 0) continue
    combined += text
  }
  return combined.trim()
}

function buildAssistantMessageContent (input: {
  assistantText: string
  reasoningText: string
}): string {
  if (input.reasoningText.length === 0) {
    return input.assistantText
  }
  if (input.assistantText.length === 0) {
    return `[Reasoning]\n${input.reasoningText}`
  }
  return `${input.assistantText}\n\n[Reasoning]\n${input.reasoningText}`
}

function toolCallsFromUnknown (value: unknown): readonly ToolCallInfo[] | null {
  if (value === null || typeof value === 'undefined') return null
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown
      return toolCallsFromUnknown(parsed)
    } catch {
      return null
    }
  }
  if (!Array.isArray(value)) return null

  const out: ToolCallInfo[] = []
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue
    const v = item as Record<string, unknown>
    const toolCallId = v.toolCallId
    const toolName = v.toolName
    const args = v.args
    if (typeof toolCallId !== 'string' || typeof toolName !== 'string') continue
    out.push({ toolCallId, toolName, args })
  }
  return out.length > 0 ? out : null
}

function toolResultsFromUnknown (
  value: unknown
): readonly ToolResultInfo[] | null {
  if (value === null || typeof value === 'undefined') return null
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown
      return toolResultsFromUnknown(parsed)
    } catch {
      return null
    }
  }
  if (!Array.isArray(value)) return null

  const out: ToolResultInfo[] = []
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue
    const v = item as Record<string, unknown>
    const toolCallId = v.toolCallId
    const toolName = v.toolName
    const result = v.result
    const isError = v.isError
    if (typeof toolCallId !== 'string' || typeof toolName !== 'string') continue
    out.push({
      toolCallId,
      toolName,
      result,
      ...(typeof isError === 'boolean' ? { isError } : null)
    })
  }
  return out.length > 0 ? out : null
}

function getPendingToolCalls (
  msgs: Array<{
    role: string
    toolCalls?: unknown
    toolResults?: unknown
  }>
): ToolCallInfo[] {
  const pendingById = new Map<string, ToolCallInfo>()

  for (const msg of msgs) {
    if (msg.role === 'assistant') {
      const toolCalls = toolCallsFromUnknown(msg.toolCalls)
      if (!toolCalls) continue
      for (const tc of toolCalls) {
        pendingById.set(tc.toolCallId, tc)
      }
      continue
    }

    if (msg.role === 'tool') {
      const toolResults = toolResultsFromUnknown(msg.toolResults)
      if (!toolResults) continue
      for (const tr of toolResults) {
        pendingById.delete(tr.toolCallId)
      }
    }
  }

  return [...pendingById.values()]
}

async function readStreamLimited (
  stream: ReadableStream<unknown>,
  maxChars: number
): Promise<ReadStreamLimitedResult> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let text = ''
  let truncated = false

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value == null) continue

      const chunk =
        typeof value === 'string'
          ? value
          : value instanceof Uint8Array
          ? decoder.decode(value)
          : String(value)
      if (chunk.length === 0) continue

      const remaining = maxChars - text.length
      if (remaining <= 0) {
        truncated = true
        await reader.cancel().catch(() => {})
        break
      }

      if (chunk.length > remaining) {
        text += chunk.slice(0, remaining)
        truncated = true
        await reader.cancel().catch(() => {})
        break
      }

      text += chunk
    }
  } finally {
    reader.releaseLock()
  }

  return { text: text.trim(), truncated }
}

export function createCoordinatorApiRequestTool (input: {
  baseUrl: string
  userAuthHeader: string
}): Tool {
  const managerOrigin = getManagerOrigin(input.baseUrl)
  const userAuthHeader = input.userAuthHeader.trim()
  const allowedMethods = new Set([
    'GET',
    'POST',
    'PUT',
    'PATCH',
    'DELETE',
    'HEAD',
    'OPTIONS'
  ] as const)

  return tool<CoordinatorApiRequestInput, unknown>({
    description:
      'Send an authenticated manager API HTTP request with safe JSON serialization and structured response output.',
    inputSchema: jsonSchema({
      type: 'object',
      additionalProperties: false,
      required: ['method', 'path'],
      properties: {
        method: {
          type: 'string',
          enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'],
          description: 'HTTP method.'
        },
        path: {
          type: 'string',
          description:
            'Manager route path starting with "/" or an absolute http/https URL. Examples: "/images/{imageId}", "https://runtime.example.com/session".'
        },
        query: {
          type: 'object',
          additionalProperties: {
            anyOf: [
              { type: 'string' },
              { type: 'number' },
              { type: 'boolean' },
              { type: 'null' }
            ]
          },
          description: 'Optional query parameters.'
        },
        headers: {
          type: 'object',
          additionalProperties: { type: 'string' },
          description:
            'Optional extra headers. Authorization is auto-applied only for manager-origin requests.'
        },
        json: {
          description:
            'Optional JSON request body. Prefer this over bodyText for PATCH/POST/PUT.'
        },
        bodyText: {
          type: 'string',
          description:
            'Optional raw request body text. Do not combine with json.'
        },
        timeoutMs: {
          type: 'number',
          description:
            'Optional timeout in milliseconds (1000-120000, default 30000).'
        }
      }
    }),
    execute: async request => {
      const method = request.method.trim().toUpperCase()
      if (!allowedMethods.has(method as CoordinatorApiRequestInput['method'])) {
        throw new Error(`Unsupported method: ${request.method}`)
      }

      const path = request.path.trim()
      if (path.length === 0) throw new Error('path is required')
      if (
        !path.startsWith('/') &&
        !path.startsWith('http://') &&
        !path.startsWith('https://')
      ) {
        throw new Error(
          'path must start with "/" or be an absolute http/https URL'
        )
      }

      if (
        typeof request.bodyText === 'string' &&
        typeof request.json !== 'undefined'
      ) {
        throw new Error('Provide only one of json or bodyText')
      }

      const timeoutMsRaw =
        typeof request.timeoutMs === 'number' &&
        Number.isFinite(request.timeoutMs)
          ? Math.floor(request.timeoutMs)
          : 30_000
      const timeoutMs = Math.max(1_000, Math.min(120_000, timeoutMsRaw))

      const url =
        path.startsWith('http://') || path.startsWith('https://')
          ? new URL(path)
          : new URL(path, `${managerOrigin}/`)
      if (request.query && typeof request.query === 'object') {
        for (const [key, value] of Object.entries(request.query)) {
          const k = key.trim()
          if (k.length === 0) continue
          if (value === null) continue
          if (
            typeof value !== 'string' &&
            typeof value !== 'number' &&
            typeof value !== 'boolean'
          ) {
            throw new Error(`Unsupported query value type for key "${k}"`)
          }
          url.searchParams.set(k, String(value))
        }
      }

      const headers = new Headers()
      headers.set('Accept', 'application/json, text/plain;q=0.9, */*;q=0.8')

      if (request.headers && typeof request.headers === 'object') {
        for (const [key, value] of Object.entries(request.headers)) {
          const k = key.trim()
          if (k.length === 0) continue
          headers.set(k, value)
        }
      }

      if (
        userAuthHeader.length > 0 &&
        url.origin === managerOrigin &&
        !headers.has('Authorization')
      ) {
        headers.set('Authorization', userAuthHeader)
      }

      let body: string | undefined
      if (typeof request.json !== 'undefined') {
        if (!isJsonValue(request.json)) {
          throw new Error('json must be a valid JSON value')
        }
        body = JSON.stringify(request.json)
        if (!headers.has('content-type')) {
          headers.set('Content-Type', 'application/json')
        }
      } else if (typeof request.bodyText === 'string') {
        body = request.bodyText
      }

      if ((method === 'GET' || method === 'HEAD') && typeof body === 'string') {
        throw new Error(`${method} requests cannot include a request body`)
      }

      const abortController = new AbortController()
      const timeoutHandle = setTimeout(() => {
        abortController.abort(
          new Error(`Request timed out after ${timeoutMs}ms`)
        )
      }, timeoutMs)

      let response: Response
      try {
        response = await fetch(url, {
          method,
          headers,
          body,
          signal: abortController.signal
        })
      } finally {
        clearTimeout(timeoutHandle)
      }

      const responseTextRaw = await response.text()
      const bodyPreview = truncateText(
        responseTextRaw,
        MAX_COORDINATOR_API_RESPONSE_BODY_CHARS
      )
      const contentType = response.headers.get('content-type') ?? ''
      const responseBodyPath = `${url.pathname}${url.search}`

      let responseBody: unknown = bodyPreview.text
      let responseBodyType: 'text' | 'json' = 'text'
      let jsonParseError: string | undefined
      const shouldTryParseJson =
        contentType.toLowerCase().includes('application/json') &&
        bodyPreview.truncated === false

      if (shouldTryParseJson) {
        if (responseTextRaw.trim().length === 0) {
          responseBody = null
          responseBodyType = 'json'
        } else {
          try {
            const parsed = JSON.parse(responseTextRaw) as unknown
            if (!isJsonValue(parsed)) {
              jsonParseError = 'Response JSON contains unsupported value types'
            } else {
              responseBody = parsed
              responseBodyType = 'json'
            }
          } catch (error) {
            jsonParseError =
              error instanceof Error
                ? error.message
                : 'Failed to parse JSON response'
          }
        }
      }

      return {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        request: {
          method,
          path: responseBodyPath,
          url: url.toString(),
          timeoutMs
        },
        response: {
          bodyType: responseBodyType,
          body: responseBody,
          bodyTruncated: bodyPreview.truncated,
          contentType,
          ...(jsonParseError ? { jsonParseError } : null)
        }
      }
    }
  })
}

const agentSandboxBashTool = tool<AgentSandboxBashToolInput, unknown>({
  description:
    'Run a bash command in an agent sandbox by agent id. Creates the sandbox if it is missing.',
  inputSchema: jsonSchema({
    type: 'object',
    additionalProperties: false,
    required: ['agentId', 'command'],
    properties: {
      agentId: {
        type: 'string',
        description: 'Agent ID whose sandbox should run the command.'
      },
      command: {
        type: 'string',
        description: 'Shell command to run with bash -lc.'
      },
      timeoutMs: {
        type: 'number',
        description:
          'Optional timeout in milliseconds (1000-120000, default 20000).'
      },
      cwd: {
        type: 'string',
        description:
          'Optional working directory inside the sandbox. Defaults to DEFAULT_WORKING_DIR/workspaces.'
      }
    }
  }),
  execute: async input => {
    const agentId = input.agentId.trim()
    const command = input.command.trim()
    if (agentId.length === 0) throw new Error('agentId is required')
    if (command.length === 0) throw new Error('command is required')

    const timeoutMsRaw =
      typeof input.timeoutMs === 'number' && Number.isFinite(input.timeoutMs)
        ? Math.floor(input.timeoutMs)
        : 20_000
    const timeoutMs = Math.max(1_000, Math.min(120_000, timeoutMsRaw))
    const cwd = (input.cwd ?? '').trim()

    const { sandbox } = await ensureAgentSandbox({ agentId })
    const proc = await sandbox.exec(
      [
        'bash',
        '-lc',
        [
          'if [[ -n "${TOOL_CWD:-}" ]]; then',
          '  cd "${TOOL_CWD}"',
          'else',
          '  cd "${DEFAULT_WORKING_DIR:-${WORKSPACES_DIR:-${AGENT_HOME:-/home/agent}/workspaces}}"',
          'fi',
          'bash -lc "${TOOL_COMMAND}"'
        ].join('\n')
      ],
      {
        timeoutMs,
        env: {
          TOOL_COMMAND: command,
          TOOL_CWD: cwd
        }
      }
    )

    const [stdout, stderr, exitCode] = await Promise.all([
      readStreamLimited(proc.stdout, 40_000),
      readStreamLimited(proc.stderr, 20_000),
      proc.wait()
    ])

    return {
      agentId,
      sandboxId: sandbox.sandboxId,
      exitCode,
      stdout: stdout.text,
      stderr: stderr.text,
      stdoutTruncated: stdout.truncated,
      stderrTruncated: stderr.truncated,
      timeoutMs
    }
  }
})

const IMPLEMENTED_CLIENT_TOOL_NAMES = [
  'ui_run_action',
  'ui_list_available_actions',
  'ui_get_state',
  'ui_browser_navigate',
  'ui_browser_snapshot',
  'ui_browser_click',
  'ui_browser_type',
  'ui_browser_wait',
  'ui_browser_scroll',
  'ui_browser_eval'
] as const

assertCoordinatorClientToolNamesMatch({
  implementedToolNames: IMPLEMENTED_CLIENT_TOOL_NAMES,
  source: 'agent-manager coordinator createClientUiTools'
})

function createClientUiTools (
  clientTools: RunAgentStreamClientTools
): Record<string, Tool> {
  const uiRunActionTool = tool<
    {
      actionId: string
      actionVersion?: number
      params?: unknown
      timeoutMs?: number
    },
    unknown
  >({
    description:
      'Run one semantic UI action in the active browser-attached client. Use list_available_actions first when unsure.',
    inputSchema: jsonSchema({
      type: 'object',
      additionalProperties: false,
      required: ['actionId'],
      properties: {
        actionId: {
          type: 'string',
          description: 'Semantic action ID (e.g. "chat.send_message").'
        },
        actionVersion: {
          type: 'number',
          description: 'Action version. Use 1 unless told otherwise.'
        },
        params: {
          description: 'Action params object. Shape depends on actionId.'
        },
        timeoutMs: {
          type: 'number',
          description: 'Optional client action timeout in milliseconds.'
        }
      }
    }),
    execute: async (input, options) => {
      const actionId = input.actionId.trim()
      if (actionId.length === 0) throw new Error('actionId is required')

      return await clientTools.requestClientTool({
        toolCallId: options.toolCallId,
        toolName: 'ui_run_action',
        args: {
          actionId,
          actionVersion:
            typeof input.actionVersion === 'number' &&
            Number.isFinite(input.actionVersion)
              ? Math.floor(input.actionVersion)
              : 1,
          params: typeof input.params === 'undefined' ? {} : input.params
        },
        timeoutMs: input.timeoutMs
      })
    }
  })

  const uiListAvailableActionsTool = tool<Record<string, never>, unknown>({
    description:
      'List semantic UI actions that are currently available in the browser-attached client.',
    inputSchema: jsonSchema({
      type: 'object',
      additionalProperties: false,
      properties: {}
    }),
    execute: async (_input, options) => {
      return await clientTools.requestClientTool({
        toolCallId: options.toolCallId,
        toolName: 'ui_list_available_actions',
        args: {},
        timeoutMs: 10_000
      })
    }
  })

  const uiGetStateTool = tool<Record<string, never>, unknown>({
    description:
      'Get a structured semantic snapshot of the current client UI state (route, chat, workspace layout and panel summaries).',
    inputSchema: jsonSchema({
      type: 'object',
      additionalProperties: false,
      properties: {}
    }),
    execute: async (_input, options) => {
      return await clientTools.requestClientTool({
        toolCallId: options.toolCallId,
        toolName: 'ui_get_state',
        args: {},
        timeoutMs: 10_000
      })
    }
  })

  const uiBrowserNavigateTool = tool<
    {
      to: string
      newTab?: boolean
      timeoutMs?: number
    },
    unknown
  >({
    description:
      'Fallback browser navigation tool. Prefer semantic nav.go when possible.',
    inputSchema: jsonSchema({
      type: 'object',
      additionalProperties: false,
      required: ['to'],
      properties: {
        to: {
          type: 'string',
          description: 'Route path or URL.'
        },
        newTab: {
          type: 'boolean',
          description: 'Open in a new tab.'
        },
        timeoutMs: {
          type: 'number',
          description: 'Optional client action timeout in milliseconds.'
        }
      }
    }),
    execute: async (input, options) => {
      return await clientTools.requestClientTool({
        toolCallId: options.toolCallId,
        toolName: 'ui_browser_navigate',
        args: {
          to: input.to,
          ...(typeof input.newTab === 'boolean' ? { newTab: input.newTab } : {})
        },
        timeoutMs: input.timeoutMs
      })
    }
  })

  const uiBrowserSnapshotTool = tool<
    {
      includeHtml?: boolean
      includeText?: boolean
      includeScreenshot?: boolean
      maxHtmlChars?: number
      maxTextChars?: number
      timeoutMs?: number
    },
    unknown
  >({
    description:
      'Fallback browser snapshot tool (DOM HTML/text and optional screenshot).',
    inputSchema: jsonSchema({
      type: 'object',
      additionalProperties: false,
      properties: {
        includeHtml: { type: 'boolean' },
        includeText: { type: 'boolean' },
        includeScreenshot: { type: 'boolean' },
        maxHtmlChars: { type: 'number' },
        maxTextChars: { type: 'number' },
        timeoutMs: { type: 'number' }
      }
    }),
    execute: async (input, options) => {
      return await clientTools.requestClientTool({
        toolCallId: options.toolCallId,
        toolName: 'ui_browser_snapshot',
        args: {
          ...(typeof input.includeHtml === 'boolean'
            ? { includeHtml: input.includeHtml }
            : {}),
          ...(typeof input.includeText === 'boolean'
            ? { includeText: input.includeText }
            : {}),
          ...(typeof input.includeScreenshot === 'boolean'
            ? { includeScreenshot: input.includeScreenshot }
            : {}),
          ...(typeof input.maxHtmlChars === 'number'
            ? { maxHtmlChars: input.maxHtmlChars }
            : {}),
          ...(typeof input.maxTextChars === 'number'
            ? { maxTextChars: input.maxTextChars }
            : {})
        },
        timeoutMs: input.timeoutMs
      })
    }
  })

  const uiBrowserClickTool = tool<
    {
      selector: string
      button?: 'left' | 'right'
      double?: boolean
      delayMs?: number
      timeoutMs?: number
    },
    unknown
  >({
    description:
      'Fallback browser click tool by CSS selector. Prefer semantic actions first.',
    inputSchema: jsonSchema({
      type: 'object',
      additionalProperties: false,
      required: ['selector'],
      properties: {
        selector: { type: 'string' },
        button: { type: 'string', enum: ['left', 'right'] },
        double: { type: 'boolean' },
        delayMs: { type: 'number' },
        timeoutMs: { type: 'number' }
      }
    }),
    execute: async (input, options) => {
      return await clientTools.requestClientTool({
        toolCallId: options.toolCallId,
        toolName: 'ui_browser_click',
        args: {
          selector: input.selector,
          ...(typeof input.button === 'string' ? { button: input.button } : {}),
          ...(typeof input.double === 'boolean'
            ? { double: input.double }
            : {}),
          ...(typeof input.delayMs === 'number'
            ? { delayMs: input.delayMs }
            : {})
        },
        timeoutMs: input.timeoutMs
      })
    }
  })

  const uiBrowserTypeTool = tool<
    {
      selector?: string
      text?: string
      clear?: boolean
      pressKey?: string
      submit?: boolean
      timeoutMs?: number
    },
    unknown
  >({
    description:
      'Fallback browser typing tool. Supports typing text and pressing keys.',
    inputSchema: jsonSchema({
      type: 'object',
      additionalProperties: false,
      properties: {
        selector: { type: 'string' },
        text: { type: 'string' },
        clear: { type: 'boolean' },
        pressKey: { type: 'string' },
        submit: { type: 'boolean' },
        timeoutMs: { type: 'number' }
      }
    }),
    execute: async (input, options) => {
      return await clientTools.requestClientTool({
        toolCallId: options.toolCallId,
        toolName: 'ui_browser_type',
        args: {
          ...(typeof input.selector === 'string'
            ? { selector: input.selector }
            : {}),
          ...(typeof input.text === 'string' ? { text: input.text } : {}),
          ...(typeof input.clear === 'boolean' ? { clear: input.clear } : {}),
          ...(typeof input.pressKey === 'string'
            ? { pressKey: input.pressKey }
            : {}),
          ...(typeof input.submit === 'boolean' ? { submit: input.submit } : {})
        },
        timeoutMs: input.timeoutMs
      })
    }
  })

  const uiBrowserWaitTool = tool<
    {
      ms?: number
      selector?: string
      visible?: string
      hidden?: string
      nav?: boolean
      idle?: boolean
      timeoutMs?: number
    },
    unknown
  >({
    description:
      'Fallback browser wait tool for selector/nav/idle/time conditions.',
    inputSchema: jsonSchema({
      type: 'object',
      additionalProperties: false,
      properties: {
        ms: { type: 'number' },
        selector: { type: 'string' },
        visible: { type: 'string' },
        hidden: { type: 'string' },
        nav: { type: 'boolean' },
        idle: { type: 'boolean' },
        timeoutMs: { type: 'number' }
      }
    }),
    execute: async (input, options) => {
      return await clientTools.requestClientTool({
        toolCallId: options.toolCallId,
        toolName: 'ui_browser_wait',
        args: {
          ...(typeof input.ms === 'number' ? { ms: input.ms } : {}),
          ...(typeof input.selector === 'string'
            ? { selector: input.selector }
            : {}),
          ...(typeof input.visible === 'string'
            ? { visible: input.visible }
            : {}),
          ...(typeof input.hidden === 'string' ? { hidden: input.hidden } : {}),
          ...(typeof input.nav === 'boolean' ? { nav: input.nav } : {}),
          ...(typeof input.idle === 'boolean' ? { idle: input.idle } : {}),
          ...(typeof input.timeoutMs === 'number'
            ? { timeoutMs: input.timeoutMs }
            : {})
        },
        timeoutMs: input.timeoutMs
      })
    }
  })

  const uiBrowserScrollTool = tool<
    {
      direction?: 'up' | 'down' | 'left' | 'right' | 'top' | 'bottom'
      pixels?: number
      selector?: string
      timeoutMs?: number
    },
    unknown
  >({
    description: 'Fallback browser scrolling tool by direction or selector.',
    inputSchema: jsonSchema({
      type: 'object',
      additionalProperties: false,
      properties: {
        direction: {
          type: 'string',
          enum: ['up', 'down', 'left', 'right', 'top', 'bottom']
        },
        pixels: { type: 'number' },
        selector: { type: 'string' },
        timeoutMs: { type: 'number' }
      }
    }),
    execute: async (input, options) => {
      return await clientTools.requestClientTool({
        toolCallId: options.toolCallId,
        toolName: 'ui_browser_scroll',
        args: {
          ...(typeof input.direction === 'string'
            ? { direction: input.direction }
            : {}),
          ...(typeof input.pixels === 'number' ? { pixels: input.pixels } : {}),
          ...(typeof input.selector === 'string'
            ? { selector: input.selector }
            : {})
        },
        timeoutMs: input.timeoutMs
      })
    }
  })

  const uiBrowserEvalTool = tool<
    {
      expression: string
      timeoutMs?: number
    },
    unknown
  >({
    description: 'Fallback browser eval tool for DOM/script inspection.',
    inputSchema: jsonSchema({
      type: 'object',
      additionalProperties: false,
      required: ['expression'],
      properties: {
        expression: { type: 'string' },
        timeoutMs: { type: 'number' }
      }
    }),
    execute: async (input, options) => {
      return await clientTools.requestClientTool({
        toolCallId: options.toolCallId,
        toolName: 'ui_browser_eval',
        args: {
          expression: input.expression
        },
        timeoutMs: input.timeoutMs
      })
    }
  })

  return {
    ui_run_action: uiRunActionTool,
    ui_list_available_actions: uiListAvailableActionsTool,
    ui_get_state: uiGetStateTool,
    ui_browser_navigate: uiBrowserNavigateTool,
    ui_browser_snapshot: uiBrowserSnapshotTool,
    ui_browser_click: uiBrowserClickTool,
    ui_browser_type: uiBrowserTypeTool,
    ui_browser_wait: uiBrowserWaitTool,
    ui_browser_scroll: uiBrowserScrollTool,
    ui_browser_eval: uiBrowserEvalTool
  }
}

function messagesToModelMessages (
  msgs: Array<{
    id: string
    role: string
    content: string
    toolCalls?: unknown
    toolResults?: unknown
  }>
): ModelMessage[] {
  const result: ModelMessage[] = []

  for (const msg of msgs) {
    if (msg.role === 'user') {
      result.push({ role: 'user', content: msg.content })
    } else if (msg.role === 'assistant') {
      const toolCalls = toolCallsFromUnknown(msg.toolCalls)
      if (toolCalls && toolCalls.length > 0) {
        const parts: Array<
          | { readonly type: 'text'; readonly text: string }
          | {
              readonly type: 'tool-call'
              readonly toolCallId: string
              readonly toolName: string
              readonly input: unknown
            }
        > = []
        if (msg.content.trim().length > 0) {
          parts.push({ type: 'text', text: msg.content })
        }
        for (const tc of toolCalls) {
          parts.push({
            type: 'tool-call',
            toolCallId: tc.toolCallId,
            toolName: tc.toolName,
            input: tc.args
          })
        }
        result.push({ role: 'assistant', content: parts })
      } else if (msg.content.trim().length > 0) {
        result.push({ role: 'assistant', content: msg.content })
      }
    } else if (msg.role === 'tool') {
      const toolResults = toolResultsFromUnknown(msg.toolResults)
      if (!toolResults || toolResults.length === 0) continue
      result.push({
        role: 'tool',
        content: toolResults.map(tr => ({
          type: 'tool-result',
          toolCallId: tr.toolCallId,
          toolName: tr.toolName,
          output: toolResultToOutput(tr.result, tr.isError)
        }))
      })
    }
  }

  return result
}

function getModel (model: string): LanguageModel {
  if (!model.includes('/')) {
    return openai(model)
  }
  let [provider, modelName] = model.split('/')
  if (provider === 'google') {
    return google(modelName)
  }
  if (provider === 'anthropic') {
    return anthropic(modelName)
  }
  if (provider === 'openai') {
    return openai(modelName)
  }
  throw new Error(`Unsupported model: ${model}`)
}

export async function runAgentStream (input: {
  userId: string
  coordinatorSessionId: string
  userMessage: string
  baseUrl: string
  userAuthHeader: string
  abortSignal?: AbortSignal
  clientTools?: RunAgentStreamClientTools
}) {
  log.info('coordinator.stream.start', {
    userId: input.userId,
    coordinatorSessionId: input.coordinatorSessionId,
    userMessageChars: input.userMessage.length
  })

  const previousMessages = await getMessagesByCoordinatorSessionId(
    input.coordinatorSessionId
  )
  const pendingToolCalls = getPendingToolCalls(
    previousMessages.map(m => ({
      role: m.role,
      toolCalls: m.toolCalls,
      toolResults: m.toolResults
    }))
  )

  if (pendingToolCalls.length > 0) {
    const toolResults: ToolResultInfo[] = pendingToolCalls.map(tc => ({
      toolCallId: tc.toolCallId,
      toolName: tc.toolName,
      result: {
        status: 'not_executed',
        reason:
          'Tool call was not executed because a newer user message arrived before completion.',
        shouldRetry: true
      },
      isError: true
    }))

    const syntheticToolMessage = await addMessage({
      coordinatorSessionId: input.coordinatorSessionId,
      role: 'tool',
      content: `Tool results (${toolResults.length}) [auto-generated pending cancellation]`,
      toolResults
    })
    previousMessages.push(syntheticToolMessage)

    log.info('coordinator.stream.synthetic_tool_results_added', {
      userId: input.userId,
      coordinatorSessionId: input.coordinatorSessionId,
      unresolvedToolCalls: pendingToolCalls.length
    })
  }

  await addMessage({
    coordinatorSessionId: input.coordinatorSessionId,
    role: 'user',
    content: input.userMessage
  })

  const modelMessages = messagesToModelMessages(
    previousMessages.map(m => ({
      id: m.id,
      role: m.role,
      content: m.content,
      toolCalls: m.toolCalls,
      toolResults: m.toolResults
    }))
  )
  modelMessages.push({ role: 'user', content: input.userMessage })
  log.debug('coordinator.stream.messages_prepared', {
    userId: input.userId,
    coordinatorSessionId: input.coordinatorSessionId,
    messageCount: modelMessages.length
  })

  const bashTools = await createCoordinatorBashTools({
    baseUrl: input.baseUrl,
    userAuthHeader: input.userAuthHeader
  })
  const coordinatorApiRequestTool = createCoordinatorApiRequestTool({
    baseUrl: input.baseUrl,
    userAuthHeader: input.userAuthHeader
  })
  const tools: Record<string, Tool> = {
    ...bashTools,
    coordinator_api_request: coordinatorApiRequestTool,
    agent_sandbox_bash: agentSandboxBashTool,
    web_search: openai.tools.webSearch({
      externalWebAccess: true,
      searchContextSize: 'high'
    }) as unknown as Tool
  }
  if (input.clientTools) {
    Object.assign(tools, createClientUiTools(input.clientTools))
  }

  const savedToolCallIds = new Set<string>()
  const savedToolResultIds = new Set<string>()
  let lastSavedAssistantContent: string | null = null
  const systemPrompt = getSystemPrompt()
  log.info('coordinator.stream.model_start', {
    userId: input.userId,
    coordinatorSessionId: input.coordinatorSessionId,
    model: process.env.COORDINATOR_AGENT_MODEL ?? 'gpt-5.2',
    browserAvailable: !!input.clientTools
  })
  const result = streamText({
    model: getModel(process.env.COORDINATOR_AGENT_MODEL ?? 'gpt-5.2'),
    system: systemPrompt,
    messages: modelMessages,
    tools,
    abortSignal: input.abortSignal,
    stopWhen: stepCountIs(50),
    onStepFinish: async stepResult => {
      const assistantText = stepResult.text.trim()
      const reasoningText = reasoningTextFromStepResult(stepResult)
      const assistantContent = buildAssistantMessageContent({
        assistantText,
        reasoningText
      })

      log.debug('coordinator.stream.step_finish', {
        userId: input.userId,
        coordinatorSessionId: input.coordinatorSessionId,
        toolCalls: stepResult.staticToolCalls.length,
        toolResults: stepResult.staticToolResults.length,
        reasoningParts: Array.isArray(stepResult.reasoning)
          ? stepResult.reasoning.length
          : 0,
        reasoningChars: reasoningText.length,
        textChars: stepResult.text.length,
        finishReason: stepResult.finishReason
      })
      const toolCalls: ToolCallInfo[] = []
      for (const tc of stepResult.staticToolCalls) {
        if (savedToolCallIds.has(tc.toolCallId)) continue
        savedToolCallIds.add(tc.toolCallId)
        toolCalls.push({
          toolCallId: tc.toolCallId,
          toolName: tc.toolName,
          args: tc.input
        })
      }

      if (toolCalls.length > 0) {
        await addMessage({
          coordinatorSessionId: input.coordinatorSessionId,
          role: 'assistant',
          content: '',
          toolCalls
        })
      }

      const toolResults: Array<{
        readonly toolCallId: string
        readonly toolName: string
        readonly result: unknown
        readonly isError?: boolean
      }> = []
      for (const tr of stepResult.staticToolResults) {
        if (savedToolResultIds.has(tr.toolCallId)) continue
        savedToolResultIds.add(tr.toolCallId)
        toolResults.push({
          toolCallId: tr.toolCallId,
          toolName: tr.toolName,
          result: tr.output
        })
      }

      if (toolResults.length > 0) {
        await addMessage({
          coordinatorSessionId: input.coordinatorSessionId,
          role: 'tool',
          content: `Tool results (${toolResults.length})`,
          toolResults
        })
      }

      if (assistantContent.length > 0) {
        if (assistantContent === lastSavedAssistantContent) return
        lastSavedAssistantContent = assistantContent
        await addMessage({
          coordinatorSessionId: input.coordinatorSessionId,
          role: 'assistant',
          content: assistantContent
        })
      }
    }
  })

  return result
}
