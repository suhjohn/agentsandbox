#!/usr/bin/env python3
from __future__ import annotations

import sys
from typing import Any

from _shared import (
    click_browser,
    error_json,
    eval_browser,
    get_flag_value,
    get_ui_state,
    has_flag,
    navigate_browser,
    parse_common_options,
    parse_params_json,
    print_json,
    type_browser,
)


def usage() -> None:
    print(
        "Usage: python3 tools/ui-actions/ui_run_action.py --action-id <id> [--params '{...}'] [--browser-url <url>] [--port <port>]"
    )


def run_action(
    action_id: str,
    params: dict[str, Any],
    options,
) -> Any:
    if action_id == "nav.go":
        to = None
        if isinstance(params.get("to"), str) and params["to"].strip():
            to = params["to"].strip()
        elif isinstance(params.get("path"), str) and params["path"].strip():
            to = params["path"].strip()
        if not to:
            raise RuntimeError("nav.go requires params.to or params.path")
        return navigate_browser(
            to,
            options,
            new_tab=params.get("newTab") is True,
        )

    if action_id == "coordinator.open_dialog":
        eval_browser(
            "window.dispatchEvent(new Event('agent-manager-web:open-coordinator')); ({ requested: true })",
            options,
        )
        return eval_browser(
            "(() => ({ chatDialogOpen: !!document.querySelector('[data-coordinator-dialog=\"true\"]') }))()",
            options,
        )

    if action_id == "coordinator.close_dialog":
        eval_browser(
            "window.dispatchEvent(new Event('agent-manager-web:close-coordinator')); ({ requested: true })",
            options,
        )
        return eval_browser(
            "(() => ({ chatDialogOpen: !!document.querySelector('[data-coordinator-dialog=\"true\"]') }))()",
            options,
        )

    if action_id == "coordinator.dialog.create_session":
        return click_browser(
            '[data-coordinator-dialog="true"] button[title="Prepare new coordinator session"]',
            options,
        )

    if action_id == "coordinator.dialog.select_agent":
        agent_id = params.get("agentId")
        if not isinstance(agent_id, str) or not agent_id.strip():
            raise RuntimeError("coordinator.dialog.select_agent requires params.agentId")
        return eval_browser(
            f"""(() => {{
              const select = document.querySelector('[aria-label="Coordinator agent"]');
              if (!(select instanceof HTMLSelectElement)) {{
                throw new Error('Coordinator agent select unavailable');
              }}
              const target = {agent_id!r};
              const option = Array.from(select.options).find((item) => item.value === target);
              if (!option) {{
                throw new Error('Coordinator agent option not found');
              }}
              select.value = target;
              select.dispatchEvent(new Event('change', {{ bubbles: true }}));
              return {{ agentId: select.value, agentLabel: option.textContent?.trim() || '' }};
            }})()""",
            options,
        )

    if action_id == "chat.send_message":
        text = params.get("text")
        if not isinstance(text, str) or not text.strip():
            raise RuntimeError("chat.send_message requires params.text")
        selector = params.get("selector")
        if not isinstance(selector, str) or not selector.strip():
            selector = '[data-coordinator-dialog="true"] textarea, textarea'
        typed = type_browser(
            options,
            selector=selector,
            text=text.strip(),
            clear=params.get("replace") is True,
        )
        submitted = type_browser(
            options,
            selector=selector,
            press_key="Enter",
        )
        return {
            "typed": typed,
            "submitted": submitted,
        }

    raise RuntimeError(f"Unsupported actionId: {action_id}")


def main() -> int:
    argv = sys.argv[1:]
    if has_flag(argv, "--help") or has_flag(argv, "-h"):
        usage()
        return 0

    action_id = get_flag_value(argv, "--action-id")
    if action_id is None or action_id.strip() == "":
        usage()
        raise RuntimeError("--action-id is required")

    options = parse_common_options(argv)
    params = parse_params_json(get_flag_value(argv, "--params"))
    before = get_ui_state(options)
    result = run_action(action_id.strip(), params, options)
    after = get_ui_state(options)

    print_json(
        {
            "ok": True,
            "data": {
                "actionId": action_id.strip(),
                "params": params,
                "result": result,
                "uiStateBefore": before,
                "uiStateAfter": after,
            },
        }
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001
        error_json(str(exc))
        raise SystemExit(1)
