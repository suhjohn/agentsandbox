#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any


def _resolve_browser_tools_root() -> Path:
    candidates = [
        Path.cwd() / "tools" / "default" / "browser-tools",
        Path.cwd() / "agent-go" / "tools" / "browser-tools",
        Path(__file__).resolve().parents[5] / "agent-go" / "tools" / "browser-tools",
    ]
    for candidate in candidates:
        if (candidate / "_shared.py").exists():
            return candidate
    raise RuntimeError(
        "Could not locate browser-tools. Expected tools/default/browser-tools or agent-go/tools/browser-tools."
    )


_BROWSER_TOOLS_ROOT = _resolve_browser_tools_root()


def _load_browser_tools_module(module_name: str):
    unique_name = f"ui_actions_browser_tools_{module_name}"
    if unique_name in sys.modules:
        return sys.modules[unique_name]
    module_path = _BROWSER_TOOLS_ROOT / f"{module_name}.py"
    spec = importlib.util.spec_from_file_location(
        unique_name,
        module_path,
    )
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Failed to load browser tools module: {module_name}")
    module = importlib.util.module_from_spec(spec)
    previous_shared = sys.modules.get("_shared")
    shared_spec = importlib.util.spec_from_file_location(
        "_shared",
        _BROWSER_TOOLS_ROOT / "_shared.py",
    )
    if shared_spec is None or shared_spec.loader is None:
        raise RuntimeError("Failed to load browser tools shared module")
    shared_module = importlib.util.module_from_spec(shared_spec)
    sys.modules["_shared"] = shared_module
    shared_spec.loader.exec_module(shared_module)
    try:
        sys.modules[unique_name] = module
        spec.loader.exec_module(module)
    finally:
        if previous_shared is not None:
            sys.modules["_shared"] = previous_shared
        else:
            sys.modules.pop("_shared", None)
    return module


_click_module = _load_browser_tools_module("click")
_eval_module = _load_browser_tools_module("eval")
_nav_module = _load_browser_tools_module("nav")
_start_module = _load_browser_tools_module("start")
_wait_module = _load_browser_tools_module("wait")
_type_module = _load_browser_tools_module("type")

ClickInput = getattr(_click_module, "ClickInput")
click_element = getattr(_click_module, "click_element")
EvalArgs = getattr(_eval_module, "EvalArgs")
evaluate_expression = getattr(_eval_module, "evaluate_expression")
NavigateArgs = getattr(_nav_module, "NavigateArgs")
navigate_to = getattr(_nav_module, "navigate_to")
StartBrowserInput = getattr(_start_module, "StartBrowserInput")
ensure_browser_started = getattr(_start_module, "ensure_browser_started")
WaitInput = getattr(_wait_module, "WaitInput")
WaitMode = getattr(_wait_module, "WaitMode")
wait_for_condition = getattr(_wait_module, "wait_for_condition")
TypeInput = getattr(_type_module, "TypeInput")
type_into_page = getattr(_type_module, "type_into_page")


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


def run_cli(main) -> None:
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        error_json("Interrupted")
        raise SystemExit(1)
    except Exception as exc:  # noqa: BLE001
        error_json(str(exc))
        raise SystemExit(1)


def ensure_browser_ready(options: CommonOptions) -> dict[str, Any]:
    result = ensure_browser_started(StartBrowserInput(), options.browser_argv)
    return asdict(result)


def navigate_browser(
    to: str,
    options: CommonOptions,
    *,
    new_tab: bool = False,
) -> dict[str, Any]:
    result = navigate_to(
        NavigateArgs(url=to, new_tab=new_tab),
        options.browser_argv,
    )
    return asdict(result)


def click_browser(
    selector: str,
    options: CommonOptions,
    *,
    button: str = "left",
    double: bool = False,
    delay_ms: int = 0,
) -> dict[str, Any]:
    result = click_element(
        ClickInput(
            selector=selector,
            right_click=button == "right",
            double_click=double,
            delay_ms=delay_ms,
        ),
        options.browser_argv,
    )
    return asdict(result)


def type_browser(
    options: CommonOptions,
    *,
    selector: str | None = None,
    text: str | None = None,
    clear: bool = False,
    press_key: str | None = None,
) -> dict[str, Any]:
    result = type_into_page(
        TypeInput(
            selector=selector,
            text=text,
            clear=clear,
            press_key=press_key,
        ),
        options.browser_argv,
    )
    return asdict(result)


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
    if ms is not None:
        mode = WaitMode(kind="delay", ms=ms)
    elif selector is not None:
        mode = WaitMode(kind="selector", selector=selector)
    elif visible is not None:
        mode = WaitMode(kind="visible", selector=visible)
    elif hidden is not None:
        mode = WaitMode(kind="hidden", selector=hidden)
    elif nav:
        mode = WaitMode(kind="nav")
    else:
        mode = WaitMode(kind="idle")
    result = wait_for_condition(
        WaitInput(mode=mode, timeout_ms=timeout_ms),
        options.browser_argv,
    )
    return asdict(result)


def eval_browser(expression: str, options: CommonOptions) -> Any:
    result = evaluate_expression(
        EvalArgs(expression=expression),
        options.browser_argv,
    )
    return result.value


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
    ensure_browser_ready(options)
    raw = eval_browser(
        """(() => {
          const dialogRoot = document.querySelector('[data-coordinator-dialog="true"]');
          const agentSelect = document.querySelector('[aria-label="Coordinator agent"]');
          const composer = document.querySelector('[data-coordinator-dialog="true"] textarea, textarea');
          const coordinatorAgents =
            agentSelect instanceof HTMLSelectElement
              ? Array.from(agentSelect.options).map((option) => ({
                  id: option.value,
                  label: (option.textContent || '').trim(),
                }))
              : [];
          const visibleText = (document.body?.innerText || '').trim().slice(0, 2000);
          return {
            url: window.location.href,
            routePath: window.location.pathname || '/',
            title: document.title || '',
            chatDialogOpen: !!dialogRoot,
            conversationComposerVisible: !!(composer instanceof HTMLElement && composer.offsetParent !== null),
            coordinatorAgentSelectVisible: !!(agentSelect instanceof HTMLElement && agentSelect.offsetParent !== null),
            coordinatorAgentId:
              agentSelect instanceof HTMLSelectElement && agentSelect.value.trim().length > 0
                ? agentSelect.value
                : null,
            coordinatorAgents,
            newChatAvailable: !!document.querySelector('[data-coordinator-dialog="true"] button[title="Prepare new coordinator session"]'),
            createCoordinatorAgentAvailable: !!document.querySelector('[data-coordinator-dialog="true"] button[title="Create a new coordinator agent"]'),
            sessionListVisible: !!document.querySelector('[data-coordinator-dialog="true"] .divide-y.divide-border'),
            visibleText,
          };
        })()""",
        options,
    )
    if not isinstance(raw, dict):
        raise RuntimeError("Unexpected ui state response")

    state = {
        "url": raw.get("url") if isinstance(raw.get("url"), str) else "",
        "routePath": raw.get("routePath") if isinstance(raw.get("routePath"), str) else "/",
        "title": raw.get("title") if isinstance(raw.get("title"), str) else "",
        "chatDialogOpen": bool(raw.get("chatDialogOpen")),
        "conversationComposerVisible": bool(raw.get("conversationComposerVisible")),
        "coordinatorAgentSelectVisible": bool(raw.get("coordinatorAgentSelectVisible")),
        "coordinatorAgentId": raw.get("coordinatorAgentId")
        if isinstance(raw.get("coordinatorAgentId"), str) and raw.get("coordinatorAgentId", "").strip()
        else None,
        "coordinatorAgents": raw.get("coordinatorAgents")
        if isinstance(raw.get("coordinatorAgents"), list)
        else [],
        "newChatAvailable": bool(raw.get("newChatAvailable")),
        "createCoordinatorAgentAvailable": bool(raw.get("createCoordinatorAgentAvailable")),
        "sessionListVisible": bool(raw.get("sessionListVisible")),
        "visibleText": raw.get("visibleText") if isinstance(raw.get("visibleText"), str) else "",
    }
    state["availableActions"] = [asdict(item) for item in _compute_available_actions(state)]
    return state


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
