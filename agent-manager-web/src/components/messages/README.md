# Message Components

This directory contains components for rendering agent messages from different agent types (Codex, Pi).

## Visual Specifications

### Tool Calls / MCP Tool Calls

- **Trigger row**: Status indicator (dot/spinner) + tool name (green) + truncated args (tertiary)
- **Collapsible content**: Left inset (`ml-4`), no chevron
- **Request section**: "REQUEST" label (uppercase, tertiary) + JSON-formatted arguments in `<pre>`
- **Response section**: "RESPONSE" label (uppercase, tertiary) + JSON-formatted result in `<pre>`

### Bash / Command Execution

- **Trigger row**: Status indicator (dot/spinner) + "bash" (primary text) + truncated command (tertiary)
- **Collapsible content**: Left inset (`ml-4`), no chevron
- **Command section**: "COMMAND" label (uppercase, tertiary) + full command in `<pre>`
- **Exit code**: Shown if available
- **Output section**: "OUTPUT" label (uppercase, tertiary) + output in `<pre>` (max-height with scroll)

### Status Indicators

- **Pending/Started/Updated**: Spinning loader icon
- **Completed**: Green filled circle
- **Failed**: Red filled circle
- **Text messages**: White filled circle

### Text Messages

- Use the shared text row component so the indicator aligns to the first rendered line of markdown content
- Reset top margin on the first markdown block and bottom margin on the last block inside the text row

### Text Colors

| Element | Color Class |
|---------|-------------|
| Tool name | `text-text-primary` + `font-bold` |
| "bash" label | `text-text-primary` |
| Truncated args/command | `text-text-tertiary` |
| Section labels (REQUEST, RESPONSE, etc.) | `text-text-tertiary` |
| Content text | `text-text-secondary` |

### Collapsible Behavior

- All collapsibles respond to global toggle events (`collapsible:toggle-all`)
- Content background: `bg-surface-3`
- Content left inset for tool/bash bodies: `ml-4`
- Content padding: `px-3 py-2`
- Max height for scrollable sections: `max-h-60`

### JSON Formatting

Arguments and results are displayed as pretty-printed JSON (`JSON.stringify(value, null, 2)`). If the value is already a JSON string, it's parsed first then re-formatted.
