---
name: create-session
description: Use this skill when the user wants to spin up a brand new agent and immediately send it a first message. Triggers on deep-dive/analysis requests targeting a specific image, explicit requests to launch/bootstrap/start an agent, or any request that implies a fresh runtime run without an existing agentId.
---

# Create Session

Use this skill for end-to-end agent creation and first-run dispatch in AgentSandbox.

Primary user intents:

The common pattern is: **a task or question + an image name**. The image can be any kind of project — a web app, API server, mobile app, data pipeline, CLI tool, library, or monorepo.

### Code exploration and architecture

- "Do a deep dive on how `<image>` is structured."
- "Audit the backend architecture of `<image>` and explain how data flows through it."
- "Walk me through `<image>` like I'm onboarding as a new engineer."
- "Map out the full request lifecycle in `<image>`, including middleware, auth, and persistence."
- "Explain how `<image>` handles routing, validation, and error handling."
- "Review `<image>` and produce an architecture diagram in text form."
- "Inspect `<image>` startup, dependency wiring, and runtime configuration."
- "Trace how `<image>` processes a typical user action and where state is read/written."

### Feature implementation

- "Implement dark mode support in `<image>`."
- "Add pagination to the search results page in `<image>`."
- "Build a CSV export feature for the dashboard in `<image>`."
- "Add rate limiting to the API in `<image>`."
- "Implement OAuth login with GitHub in `<image>`."
- "Add a job queue for background email sending in `<image>`."
- "Wire up WebSocket support for live updates in `<image>`."
- "Create a new session to implement highlights/annotations in `<image>`."

### Bug investigation and fixing

- "Figure out why `<image>` crashes on startup."
- "The login flow in `<image>` is broken — investigate and fix it."
- "Track down the memory leak in `<image>`'s worker process."
- "Why is the `<image>` API returning 500s on `/checkout`?"
- "Fix the race condition in `<image>`'s job scheduler."

### Refactoring and code quality

- "Refactor the auth module in `<image>` to use JWTs."
- "Clean up dead code and unused dependencies in `<image>`."
- "Break apart the monolithic `routes.ts` in `<image>` into feature modules."
- "Migrate `<image>` from JavaScript to TypeScript."
- "Replace the ORM in `<image>` with raw SQL queries."

### Testing

- "Write unit tests for the payment service in `<image>`."
- "Add end-to-end tests for the signup flow in `<image>`."
- "Increase test coverage on `<image>`'s core utilities."
- "Set up a testing harness for `<image>`'s API layer."

### Performance and reliability

- "Profile `<image>` under load and identify bottlenecks."
- "Optimize the slow database queries in `<image>`."
- "Add caching to the most expensive endpoints in `<image>`."
- "Investigate why `<image>`'s build times are so slow."

### Security review

- "Audit `<image>` for common web vulnerabilities."
- "Review `<image>`'s auth paths, trust boundaries, and likely weak points."
- "Check `<image>` for exposed secrets or insecure dependencies."

### Documentation and onboarding

- "Write a technical README for `<image>`."
- "Document the API surface of `<image>`."
- "Produce an onboarding guide for new engineers joining `<image>`."
- "Summarize the core design decisions and tradeoffs in `<image>`."

### Explicit agent launch

- User explicitly asks to spin up/start/launch/bootstrap an agent and run a prompt immediately.
- User does not provide an existing `agentId` but expects runtime links or a new run.
- User asks for `runId`, stream URLs, or access links as part of creation.

Do not use this skill when:

- The user provides an existing `agentId` and only wants to continue or resume work — use the **Continue Existing Agent Run** skill instead.
- The user is asking about image creation or build setup — use the **Create Image** skill instead.

## What `POST /session` does

A single `POST /session` call:

1. Creates a new agent record from the given `imageId`.
2. Initializes (or reuses) its deterministic runtime session.
3. Dispatches the first message as a new run.

The returned `session.id` is deterministic: it is the agent UUID with hyphens removed (32-hex form). You do not need to derive it — it is returned in the response.

## Default workflow

### 1. Resolve the imageId

Call:

- `GET /images`

Shape: `{ "method": "GET", "path": "/images", "query": { "limit": 50 } }`

Paginate with `nextCursor` when needed. Match the user's image name against `response.data[].name` (for example `alexandria0`). If multiple plausible matches exist, ask the user to disambiguate before proceeding.

### 2. Call `POST /session`

Do not invent additional fields beyond the ones listed below.

**Required fields:**

- `imageId`: UUID from the image lookup above.
- `message`: The full user request to deliver as the agent's first prompt. Include all constraints and acceptance criteria verbatim.

**Optional fields:**

- `title`: Human-friendly title shown in the UI session list. Use the user's wording verbatim if provided; otherwise generate a concise, specific 3–6 word title (no quotes, no trailing punctuation).
- `harness`: Runtime harness selection. Pass through any non-empty string the user provides.
- `model`: Model override for the first run only. Omit unless the user requests a specific model.
- `modelReasoningEffort`: Reasoning effort hint for the first run only. Omit unless the user requests it.

## Response expectations

When completing this flow, always report:

- `session.id` and `session.runId`
- `session.streamUrl` and `session.runStreamUrl` so the user can observe the run
- Any `access` URLs needed to interact with the agent
- What message was dispatched as the first run

## Post-creation UI navigation

After reporting the response, wait 3 seconds (use `sleep` for 3000 ms) to give the workspace time to settle, then open the agent detail panel so the user can immediately see the session running.

Use `ui_run_action` with action `workspace.panel.open`:

```json
{
  "panelType": "agent_detail",
  "placement": "self",
  "config": {
    "agentId": "<session.agentId from POST /session response>",
    "sessionId": "<session.id from POST /session response>",
    "activeTab": "session_detail"
  }
}
```

- `session.agentId` is the agent UUID returned in the `POST /session` response.
- `session.id` is the 32-hex session ID returned in the same response.
- Use `placement: "self"` to replace the current panel in place.
- Do not skip the 3-second sleep — the panel open will silently fail if the workspace hasn't registered the new session yet.
