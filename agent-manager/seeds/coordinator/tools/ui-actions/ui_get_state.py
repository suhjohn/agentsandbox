#!/usr/bin/env python3
from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any

from _shared import get_ui_state, has_flag, parse_common_options, print_json, run_cli


@dataclass(frozen=True)
class GetUiStateResult:
    state: dict[str, Any]


def usage() -> None:
    print("Usage: python3 tools/ui-actions/ui_get_state.py [--browser-url <url>] [--port <port>]")


def read_ui_state(argv: list[str]) -> GetUiStateResult:
    return GetUiStateResult(state=get_ui_state(parse_common_options(argv)))


def run_ui_get_state_cli() -> int:
    argv = os.sys.argv[1:]
    if has_flag(argv, "--help") or has_flag(argv, "-h"):
        usage()
        return 0

    result = read_ui_state(argv)
    result = {
        "ok": True,
        "data": {
            "state": result.state,
        },
    }
    print_json(result)
    return 0


if __name__ == "__main__":
    run_cli(run_ui_get_state_cli)
