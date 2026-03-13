# UI Actions (Python)

Sandbox-side helper wrappers for coordinator UI actions.

Important:

- Canonical UI action IDs and versions live in `shared/ui-actions-contract.ts`.
- Canonical frontend execution lives in:
  - `agent-manager-web/src/coordinator-actions/executor.ts`
  - `agent-manager-web/src/ui-actions/execute.ts`
  - the live coordinator dialog/runtime surface, including `agent-manager-web/src/components/coordinator-session-dialog.tsx`
- The files in this directory are not the frontend implementation. They are a sandbox-side helper layer only.

These tools are structured like `agent-go/tools/browser-tools/*`:

- each module exposes one primary callable function
- each module also provides a thin CLI entrypoint

They currently use the repo-provided browser tools under `tools/default/browser-tools` to execute DOM interactions.

## CLI Invocation

From the workspace root inside the sandbox:

```bash
python3 tools/ui-actions/ui_get_state.py
python3 tools/ui-actions/ui_list_available_actions.py
python3 tools/ui-actions/ui_run_action.py --action-id nav.go --params '{"to":"/workspace"}'
```

From the repo checkout directly, use `agent-manager/seeds/coordinator/tools/ui-actions/...` instead.

## Python API

```python
import sys
sys.path.append("tools/ui-actions")  # run from the workspace root

from ui_get_state import read_ui_state
from ui_list_available_actions import list_available_actions
from ui_run_action import RunActionInput, execute_action

argv: list[str] = []

state = read_ui_state(argv)
actions = list_available_actions(argv)
result = execute_action(
    RunActionInput(
        action_id="nav.go",
        params={"to": "/workspace"},
    ),
    argv,
)
```

Optional `argv` flags are passed through to the underlying browser tools:

- `--browser-url <url>`
- `--port <port>`

## Modules

### Get UI State

```bash
python3 tools/ui-actions/ui_get_state.py
python3 tools/ui-actions/ui_get_state.py --port 9222
```

Primary function:

```python
read_ui_state(argv: list[str]) -> GetUiStateResult
```

Returns a browser-derived semantic snapshot of the coordinator UI, including:

- current URL and route path
- coordinator dialog visibility
- composer visibility
- coordinator agent selector visibility and selected agent id
- visible coordinator agent options
- derived `availableActions`

### List Available Actions

```bash
python3 tools/ui-actions/ui_list_available_actions.py
```

Primary function:

```python
list_available_actions(argv: list[str]) -> ListAvailableActionsResult
```

Returns the currently available semantic action descriptors derived from the current UI state.

### Run Semantic Action

```bash
python3 tools/ui-actions/ui_run_action.py --action-id nav.go --params '{"to":"/workspace"}'
python3 tools/ui-actions/ui_run_action.py --action-id coordinator.open_dialog
python3 tools/ui-actions/ui_run_action.py --action-id coordinator.dialog.select_agent --params '{"agentId":"coordinator"}'
python3 tools/ui-actions/ui_run_action.py --action-id chat.send_message --params '{"text":"hello"}'
```

Primary function:

```python
execute_action(input_data: RunActionInput, argv: list[str]) -> RunActionResult
```

Current supported action ids:

- `nav.go`
- `coordinator.open_dialog`
- `coordinator.close_dialog`
- `coordinator.dialog.create_session`
- `coordinator.dialog.select_agent`
- `chat.send_message`

`RunActionResult` includes:

- `action_id`
- `params`
- `result`
- `ui_state_before`
- `ui_state_after`

## Design Notes

- These are sandbox-side semantic wrappers, not the canonical frontend semantic action runtime.
- They must not be treated as the source of truth for action IDs, action versions, or action availability semantics.
- Raw browser interactions are delegated to `tools/default/browser-tools/*`.
- The CLI layer should stay thin; reusable behavior belongs in the primary module function.
- `ui_get_state` and `ui_list_available_actions` are browser-derived and may drift from frontend-native semantic state if selectors or UI structure change.

## Guideline

- Prefer `ui_list_available_actions.py` and `ui_run_action.py` for supported semantic tasks before reaching for raw browser tools.
- Use `ui_get_state.py` before and after multi-step changes when correctness matters.
- Keep semantic actions narrow and explicit; do not turn this layer into a generic DOM scripting surface.
- When a task does not fit an existing semantic action, use `tools/default/browser-tools/*` directly instead of overloading `ui_run_action.py`.
- Keep selectors in action implementations stable and app-specific.
- Treat this directory as a coordinator-facing semantic layer built on top of browser tools, not a replacement for them.
