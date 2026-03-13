#!/usr/bin/env python3
from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any

from _shared import get_ui_state, has_flag, parse_common_options, print_json, run_cli


@dataclass(frozen=True)
class ListAvailableActionsResult:
    actions: list[dict[str, Any]]


def usage() -> None:
    print(
        "Usage: python3 tools/ui-actions/ui_list_available_actions.py [--browser-url <url>] [--port <port>]"
    )


def list_available_actions(argv: list[str]) -> ListAvailableActionsResult:
    state = get_ui_state(parse_common_options(argv))
    return ListAvailableActionsResult(
        actions=state["availableActions"],
    )


def run_ui_list_available_actions_cli() -> int:
    argv = os.sys.argv[1:]
    if has_flag(argv, "--help") or has_flag(argv, "-h"):
        usage()
        return 0

    result = list_available_actions(argv)
    print_json(
        {
            "ok": True,
            "data": {
                "actions": result.actions,
            },
        }
    )
    return 0


if __name__ == "__main__":
    run_cli(run_ui_list_available_actions_cli)
