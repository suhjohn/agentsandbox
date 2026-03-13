#!/usr/bin/env python3
from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any


UNSUPPORTED_MESSAGE = (
    "tools/ui-actions is a frontend-consumed UI action surface and must not load "
    "or execute agent-go/tools/browser-tools. Use the frontend coordinator action "
    "runtime for ui_* behavior, or invoke agent-go/tools/browser-tools directly "
    "when sandbox-local browser automation is explicitly intended."
)


@dataclass(frozen=True)
class CommonOptions:
    browser_argv: list[str]


def parse_common_options(argv: list[str]) -> CommonOptions:
    browser_argv: list[str] = []
    i = 0
    while i < len(argv):
        arg = argv[i]
        if arg in ("--browser-url", "--port"):
            if i + 1 >= len(argv):
                raise RuntimeError(f"{arg} requires a value")
            browser_argv.extend([arg, argv[i + 1]])
            i += 2
            continue
        i += 1
    return CommonOptions(browser_argv=browser_argv)


def has_flag(argv: list[str], name: str) -> bool:
    return name in argv


def get_flag_value(argv: list[str], name: str) -> str | None:
    if name not in argv:
        return None
    idx = argv.index(name)
    if idx + 1 >= len(argv):
        return None
    value = argv[idx + 1]
    if value.startswith("--"):
        return None
    return value


def print_json(value: Any) -> None:
    print(json.dumps(value, indent=2))


def error_json(message: str) -> None:
    print_json({"ok": False, "error": message})


def _raise_unsupported() -> None:
    raise RuntimeError(UNSUPPORTED_MESSAGE)


def ensure_browser_ready(options: CommonOptions) -> dict[str, Any]:
    del options
    _raise_unsupported()


def navigate_browser(
    to: str,
    options: CommonOptions,
    *,
    new_tab: bool = False,
) -> dict[str, Any]:
    del to, options, new_tab
    _raise_unsupported()


def click_browser(
    selector: str,
    options: CommonOptions,
    *,
    button: str = "left",
    double: bool = False,
    delay_ms: int = 0,
) -> dict[str, Any]:
    del selector, options, button, double, delay_ms
    _raise_unsupported()


def type_browser(
    options: CommonOptions,
    *,
    selector: str | None = None,
    text: str | None = None,
    clear: bool = False,
    press_key: str | None = None,
) -> dict[str, Any]:
    del options, selector, text, clear, press_key
    _raise_unsupported()


def wait_browser(
    options: CommonOptions,
    *,
    ms: int | None = None,
    selector: str | None = None,
    visible: str | None = None,
    hidden: str | None = None,
    nav: bool = False,
    idle: bool = False,
    timeout_ms: int = 30000,
) -> dict[str, Any]:
    del options, ms, selector, visible, hidden, nav, idle, timeout_ms
    _raise_unsupported()


def eval_browser(expression: str, options: CommonOptions) -> Any:
    del expression, options
    _raise_unsupported()


@dataclass(frozen=True)
class AvailableAction:
    id: str
    available: bool
    description: str


def _compute_available_actions(state: dict[str, Any]) -> list[AvailableAction]:
    return [
        AvailableAction(
            id="nav.go",
            available=True,
            description="Navigate to a route path or URL.",
        ),
        AvailableAction(
            id="coordinator.open_dialog",
            available=not bool(state["chatDialogOpen"]),
            description="Open the coordinator dialog.",
        ),
        AvailableAction(
            id="coordinator.close_dialog",
            available=bool(state["chatDialogOpen"]),
            description="Close the coordinator dialog.",
        ),
        AvailableAction(
            id="coordinator.dialog.create_session",
            available=bool(state["chatDialogOpen"]) and bool(state["newChatAvailable"]),
            description="Prepare a new coordinator session from the dialog.",
        ),
        AvailableAction(
            id="coordinator.dialog.select_agent",
            available=bool(state["chatDialogOpen"]) and bool(state["coordinatorAgentSelectVisible"]),
            description="Select the active coordinator agent in the dialog.",
        ),
        AvailableAction(
            id="chat.send_message",
            available=bool(state["conversationComposerVisible"]),
            description="Type a message into the visible chat composer and submit it.",
        ),
    ]


def get_ui_state(options: CommonOptions) -> dict[str, Any]:
    del options
    _raise_unsupported()


def parse_params_json(raw: str | None) -> dict[str, Any]:
    if raw is None or raw.strip() == "":
        return {}
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Invalid --params JSON: {exc}") from exc
    if not isinstance(value, dict):
        raise RuntimeError("Invalid --params JSON: expected object")
    return value
