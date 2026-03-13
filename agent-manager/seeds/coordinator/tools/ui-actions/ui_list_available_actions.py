#!/usr/bin/env python3
from __future__ import annotations

import sys

from _shared import error_json, get_ui_state, has_flag, parse_common_options, print_json


def usage() -> None:
    print(
        "Usage: python3 tools/ui-actions/ui_list_available_actions.py [--browser-url <url>] [--port <port>]"
    )


def main() -> int:
    argv = sys.argv[1:]
    if has_flag(argv, "--help") or has_flag(argv, "-h"):
        usage()
        return 0

    state = get_ui_state(parse_common_options(argv))
    print_json(
        {
            "ok": True,
            "data": {
                "actions": state["availableActions"],
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
