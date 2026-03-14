---
name: open-agent-context
description: Use this skill when the user wants to open, reveal, focus, or jump to a specific agent or session in the workspace UI. Triggers on requests like "show that agent", "open this session", "take me to the run", or "focus the existing agent panel".
---

# Open Agent Context

Use this skill to bring an existing agent or session into view in the workspace UI with minimal duplication.

Primary user intents:

- "Open this agent"
- "Show me session `<sessionId>`"
- "Jump to the running agent"
- "Focus the panel for that session"
- "Take me to the agent detail view"
- "Bring the run into the workspace"

Do not use this skill when:

- The user wants to create a brand new agent run. Use the `create-session` skill instead.
- The user wants to rearrange multiple panes or windows as the main task. Use the layout skill instead.
- The user only wants to inspect backend runtime state, logs, or DB state. Use the runtime analysis skill instead.

## Default workflow

### 1. Resolve the target identity

Use the most concrete identifier the user gave:

- Prefer `agentId` when provided.
- Use `sessionId` when that is the only stable identifier available.
- If the user is referring to "the current run" or "the last agent", inspect current UI/session context first.

Ask a follow-up only if multiple plausible targets exist and the intended one is ambiguous.

### 2. Inspect current workspace state before opening anything

Call `ui_get_state` first.

When pane identity matters, also call `ui_run_action` with:

- `actionId: "workspace.panel.list"`

Use this to find:

- existing `agent_detail` panes
- current focused pane
- whether the workspace is ready

### 3. Prefer focus over duplication

If an existing `agent_detail` pane is already showing the requested agent/session, focus it instead of opening a new pane.

Use:

- `workspace.pane.focus`

Target by `panelInstanceId` when available.

### 4. Open or retarget the agent detail pane only when needed

If no matching pane exists, open one with:

- `workspace.panel.open`

Recommended parameters:

```json
{
  "panelType": "agent_detail",
  "placement": "self",
  "config": {
    "agentId": "<agentId>",
    "sessionId": "<sessionId>",
    "activeTab": "session_detail"
  }
}
```

Notes:

- `config.agentId` is required for `agent_detail`.
- Include `sessionId` when known so the correct session is selected immediately.
- Use `placement: "self"` by default unless the user explicitly asked to split the workspace.

If an `agent_detail` pane exists but is pointed at the wrong agent, prefer:

- `workspace.panel.set_config`

Use `target: "panel_instance"` when you already know the pane instance id.

### 5. End in the right visible state

After opening or retargeting:

- focus the pane if needed
- confirm the workspace now contains the requested agent context
- report what pane was focused or opened

## Action patterns

### Focus an already-open agent detail pane

1. `ui_get_state`
2. `workspace.panel.list`
3. `workspace.pane.focus`

### Open a fresh agent detail pane

1. `ui_get_state`
2. `workspace.panel.open`

### Retarget an existing agent detail pane

1. `ui_get_state`
2. `workspace.panel.list`
3. `workspace.panel.set_config`
4. `workspace.pane.focus`

## Operating rules

- Do not blindly open duplicate `agent_detail` panes.
- Prefer semantic UI actions over keyboard-style actions for this flow.
- When the user asks for a specific session, preserve that `sessionId` in the panel config.
- When the user asks to "show" or "jump to" something, the task is not complete until the correct pane is visible and focused.
