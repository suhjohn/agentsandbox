---
name: connect-to-agent-runtime
description: Use this skill when the user wants access to a live agent sandbox through editor, browser, HTTP runtime, or terminal connections. Triggers on requests like "open the runtime", "give me the sandbox URL", "connect a terminal", or "how do I access agent X".
---

# Connect To Agent Runtime

Use this skill for access and connectivity workflows on an existing live agent sandbox.

Primary user intents:

- "Give me access to this agent"
- "Open the runtime"
- "How do I connect to the sandbox?"
- "Give me the browser/editor URLs"
- "Open a terminal to the agent"
- "I need the auth token and agent API URL"

Do not use this skill when:

- The user wants to send a new prompt to the agent. Use `continue-agent-run`.
- The user wants a setup sandbox for an image variant rather than a live agent sandbox. Use `open-setup-sandbox`.
- The user wants backend runtime inspection performed by the coordinator instead of direct access details.

## What this flow does

There are two primary access calls:

- `GET /agents/{agentId}/access` for runtime URLs and auth token
- `POST /terminal/connect` for terminal credentials

Use one or both depending on the user's request.

## Default workflow

### 1. Resolve and verify the target agent

Use the concrete `agentId` when available.

Call:

- `GET /agents/{agentId}`

Confirm the agent exists and is the intended target.

### 2. Fetch runtime access information

Call:

- `GET /agents/{agentId}/access`

Expected outputs may include:

- `agentApiUrl`
- `agentAuthToken`
- editor/browser/runtime access URLs

Return these clearly and label what each URL is for.

### 3. Create terminal access when needed

If the user asked for shell/terminal access, call:

- `POST /terminal/connect`

Body:

```json
{
  "targetType": "agentSandbox",
  "targetId": "<agent-uuid>"
}
```

Return:

- `wsUrl`
- `terminalUrl`

### 4. Distinguish manager access from runtime access

Always make the split explicit:

- manager APIs are separate from the live runtime
- `GET /agents/{agentId}/access` returns the runtime-facing access details
- terminal credentials come from `POST /terminal/connect`

## Response expectations

Always report:

- `agentId`
- runtime access URLs
- runtime auth token when returned
- terminal connection details when requested
- whether the flow opened browser/editor access, terminal access, or both

## UI follow-up

If the user also wants the agent visible in the workspace, follow up with the `open-agent-context` flow after returning the access details.
