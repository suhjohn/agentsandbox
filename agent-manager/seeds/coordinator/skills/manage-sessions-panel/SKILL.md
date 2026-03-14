---
name: manage-sessions-panel
description: Use this skill when the user wants to open, close, filter, group, search, or focus the workspace Sessions side panel.
---

# Manage Sessions Panel

Use this skill for workspace Sessions side panel navigation and filtering.

Primary user intents:

- "Open the sessions panel"
- "Show only sessions for this image"
- "Filter to archived sessions"
- "Group sessions by status"
- "Search the sessions list"
- "Focus the sessions search box"
- "Clear the sessions filters"

Do not use this skill when:

- The user wants to open a specific session in an agent detail pane. Use `open-agent-context`.
- The user wants broader pane rearrangement. Use `arrange-workspace-layout`.
- The user wants coordinator dialog session switching rather than the workspace side panel.

## Default workflow

### 1. Inspect current state first

Start with `ui_get_state`.

Relevant snapshot fields include:

- `workspaceSessionsPanelOpen`
- `workspaceSessionsPanelGroupBy`
- `workspaceSessionsPanelHasActiveFilters`

### 2. Ensure the panel is open before mutating it

If the sessions panel is closed and the user wants to inspect, search, or filter it, open it first with:

- `workspace.sessions_panel.open`

Do not use toggle-style actions when you already know the intended final state.

### 3. Apply filters with one patch action

Use:

- `workspace.sessions_panel.set_filters`

Supported filter fields:

- `imageId`
- `agentId`
- `createdBy`
- `archived`
- `status`
- `updatedAtRange`
- `createdAtRange`
- `q`

Useful values:

- `archived`: `all`, `true`, `false`
- `updatedAtRange`: `all`, `24h`, `7d`, `30d`, `90d`
- `createdAtRange`: `all`, `24h`, `7d`, `30d`, `90d`

When the user says "clear filters", send an explicit patch that resets the relevant fields back to neutral values instead of closing the panel.

### 4. Apply grouping separately

Use:

- `workspace.sessions_panel.set_group_by`

Allowed values:

- `none`
- `imageId`
- `createdBy`
- `status`

### 5. Focus the filter input only when needed

If the user asks to search, type next, or "put the cursor in the filter box", use:

- `workspace.sessions_panel.focus_filter`

Only do this after the panel is confirmed open.

## Common recipes

### Show sessions for one image

1. `ui_get_state`
2. `workspace.sessions_panel.open` if needed
3. `workspace.sessions_panel.set_filters` with `imageId`

### Show only archived sessions

1. `ui_get_state`
2. `workspace.sessions_panel.open` if needed
3. `workspace.sessions_panel.set_filters` with:

```json
{
  "archived": "true"
}
```

### Clear filters and remove grouping

1. `ui_get_state`
2. `workspace.sessions_panel.open` if needed
3. `workspace.sessions_panel.set_filters` with neutral values
4. `workspace.sessions_panel.set_group_by` with `groupBy: "none"`

### Prepare the panel for user search

1. `ui_get_state`
2. `workspace.sessions_panel.open` if needed
3. optionally set `q`
4. `workspace.sessions_panel.focus_filter`

## Operating rules

- Prefer explicit open/close actions over `toggle` when the intended state is known.
- Patch filters in one action when possible instead of drip-feeding multiple small mutations.
- Do not focus the filter input if the panel is still closed.
- If the user asks for a sessions view and a specific session detail view in the same request, open/filter the sessions panel first, then use `open-agent-context`.
