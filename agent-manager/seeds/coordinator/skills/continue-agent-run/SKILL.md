---
name: continue-agent-run
description: Use this skill when the user already has an existing agent and wants to continue work by sending a new prompt to that agent. Triggers on requests like "continue this agent", "send a follow-up", "resume work on agent X", or "ask the running sandbox to do this next".
---

# Continue Agent Run

Use this skill for follow-up prompting on an existing agent sandbox.

Primary user intents:

- "Continue this agent"
- "Send another message to agent `<agentId>`"
- "Ask the current sandbox to do this next"
- "Resume work on that running agent"
- "Start a new run on the existing agent"

Do not use this skill when:

- The user wants a brand new agent created from an image. Use `create-session`.
- The user only wants to inspect agent or session health/status without dispatching a new prompt.
- The user wants runtime terminal/editor/browser access only. Use `connect-to-agent-runtime`.

## What this endpoint does

`POST /agents/{agentId}/session`:

1. Reuses the existing agent sandbox.
2. Creates or resumes a runtime session for that agent.
3. Dispatches the provided message as the first prompt for the new run.

## Default workflow

### 1. Resolve the target agent

Prefer a concrete `agentId` from the user.

If the user gives only a session or a vague reference like "that agent", resolve it first using the available session/agent context. Ask a short follow-up only if the target is genuinely ambiguous.

### 2. Verify the agent exists

Call:

- `GET /agents/{agentId}`

Use this to confirm:

- the agent exists
- it is the correct target
- it is in a state where continuing it makes sense

### 3. Dispatch the follow-up prompt

Call:

- `POST /agents/{agentId}/session`

Body:

```json
{
  "message": "Continue the task with these exact instructions...",
  "title": "Concise run title"
}
```

Required fields:

- `message`

Optional fields:

- `title`
- `sessionId` only when the caller explicitly needs a specific existing runtime session targeted and you already know the 32-hex session id

Rules:

- Preserve the user's instruction verbatim in `message`.
- Include all constraints and acceptance criteria.
- If no title was provided, generate a short specific title only when useful.

## Response expectations

Always report:

- `agent.id`
- `session.id`
- `session.runId`
- `session.streamUrl`
- `session.runStreamUrl`
- any returned runtime access URLs
- the exact follow-up message that was dispatched

## Post-dispatch UI navigation

After reporting the response, wait 3 seconds, then open or focus the agent detail panel so the user can see the new run.

Use `ui_run_action` with:

- `actionId: "workspace.panel.open"`

Recommended params:

```json
{
  "panelType": "agent_detail",
  "placement": "self",
  "config": {
    "agentId": "<agent.id>",
    "sessionId": "<session.id>",
    "activeTab": "session_detail"
  }
}
```

If a matching `agent_detail` pane is already open, prefer focusing or retargeting it instead of duplicating it.
