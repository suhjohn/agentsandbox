---
name: arrange-workspace-layout
description: Use this skill when the user wants to split panes, move panels, resize the workspace, switch focus, zoom, equalize, rotate, or otherwise rearrange the workspace UI layout.
---

# Arrange Workspace Layout

Use this skill for multi-step workspace layout changes.

Primary user intents:

- "Split the workspace and put X on the right"
- "Move the coordinator to the left"
- "Resize the agent pane"
- "Close the extra pane"
- "Make this layout cleaner"
- "Open sessions on the side and focus the agent"
- "Equalize the layout"
- "Zoom the current pane"

Do not use this skill when:

- The user mainly wants to open one specific agent or session. Use `open-agent-context`.
- The user mainly wants to filter or navigate the sessions side panel. Use `manage-sessions-panel`.
- The user is asking for backend runtime or session analysis rather than visible workspace arrangement.

## Default workflow

### 1. Inspect the current layout first

Always start with:

- `ui_get_state`
- `workspace.panel.list`

Use those results to identify:

- focused pane
- current panel types
- stable `leafId` and `panelInstanceId` values
- whether the requested target already exists

### 2. Translate the user request into semantic operations

Prefer semantic workspace actions over keyboard-like actions whenever you need predictable results.

Primary semantic actions:

- `workspace.panel.open`
- `workspace.pane.focus`
- `workspace.pane.move`
- `workspace.pane.close`
- `workspace.panel.resize`

Useful direct actions when the user explicitly asks for them:

- `layout.equalize`
- `layout.cycle`
- `pane.zoom.toggle`
- `window.create`
- `window.close`
- `window.next`
- `window.prev`
- `window.select_index`

### 3. Prefer stable IDs once discovered

When possible:

- focus by `panelInstanceId`
- move by `fromPanelInstanceId` / `toPanelInstanceId`
- close by `panelInstanceId`

Avoid relying on relative language like "the left one" after the first inspection pass.

### 4. Apply layout changes in a safe order

Recommended order:

1. Open any missing panels.
2. Move panes into the requested topology.
3. Resize only after panes are in the right places.
4. Focus the pane the user will most likely interact with next.
5. Equalize only if the user asked for balance or cleanup.

## Common recipes

### Split current pane and open a panel

Use `workspace.panel.open` with one of:

- `placement: "left"`
- `placement: "right"`
- `placement: "top"`
- `placement: "bottom"`
- `placement: "self"`

### Move an existing pane relative to another

Use `workspace.pane.move` with exactly one source target and one destination target:

```json
{
  "fromPanelInstanceId": "<source>",
  "toPanelInstanceId": "<destination>",
  "placement": "right"
}
```

### Resize the focused split

Use `workspace.panel.resize`:

```json
{
  "dimension": "width",
  "mode": "delta_fraction",
  "value": 0.1
}
```

Use `set_fraction` when the user gave a specific ratio or size target. Use `delta_fraction` for "a bit wider/narrower".

### Clean up extra panes

Prefer:

- `workspace.pane.close` for a specific identified pane
- `pane.close` only when the focused pane is clearly the one to close

## Operating rules

- Do not duplicate panes if the correct panel already exists and can be moved or focused.
- Do not resize before the requested panel topology exists.
- When the user says "put X beside Y", inspect first and then move by stable ids.
- If the request is ambiguous and could affect multiple panes, ask one short disambiguation question.
- End with the pane the user is likely to use next focused.
