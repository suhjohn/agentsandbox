#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass
from typing import Literal

from _shared import (
    BrowserToolsError,
    connect_active_page,
    get_flag_value,
    has_flag,
    positional_args,
    run_cli,
    wait_for_network_idle,
)


WaitKind = Literal["delay", "selector", "visible", "hidden", "nav", "idle"]


@dataclass
class WaitMode:
    kind: WaitKind
    ms: int | None = None
    selector: str | None = None


@dataclass
class WaitInput:
    mode: WaitMode
    timeout_ms: int = 30000


@dataclass
class WaitResult:
    mode: WaitKind
    elapsed_ms: int
    url: str | None = None


def usage() -> None:
    print("Usage: wait.py [ms] [--selector sel] [--visible] [--hidden] [--nav] [--idle] [--timeout ms]")


def _parse_wait_mode(argv: list[str]) -> WaitMode | None:
    selector = get_flag_value(argv, "--selector")
    visible = get_flag_value(argv, "--visible")
    hidden = get_flag_value(argv, "--hidden")
    nav = has_flag(argv, "--nav")
    idle = has_flag(argv, "--idle")

    fixed = positional_args(
        argv,
        flags_with_value=("--port", "--browser-url", "--selector", "--visible", "--hidden", "--timeout"),
    )
    fixed_ms = fixed[0] if fixed else None

    enabled = [bool(fixed_ms), bool(selector), bool(visible), bool(hidden), nav, idle]
    if sum(1 for x in enabled if x) != 1:
        return None

    if fixed_ms:
        try:
            ms = int(fixed_ms)
        except ValueError as exc:
            raise BrowserToolsError(f"Invalid delay: {fixed_ms}") from exc
        if ms < 0:
            raise BrowserToolsError(f"Invalid delay: {fixed_ms}")
        return WaitMode(kind="delay", ms=ms)
    if selector:
        return WaitMode(kind="selector", selector=selector)
    if visible:
        return WaitMode(kind="visible", selector=visible)
    if hidden:
        return WaitMode(kind="hidden", selector=hidden)
    if nav:
        return WaitMode(kind="nav")
    return WaitMode(kind="idle")


def _wait_for_selector(conn, selector: str, timeout_ms: int, mode: str) -> None:
    selector_json = json.dumps(selector)
    deadline = time.monotonic() + timeout_ms / 1000.0
    while time.monotonic() < deadline:
        state = conn.session.evaluate(
            "(() => {"
            f"const el = document.querySelector({selector_json});"
            "if (!el) return { exists: false, visible: false };"
            "const style = getComputedStyle(el);"
            "const rect = el.getBoundingClientRect();"
            "const visible = style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;"
            "return { exists: true, visible };"
            "})()"
        )
        exists = bool(state.get("exists")) if isinstance(state, dict) else False
        visible = bool(state.get("visible")) if isinstance(state, dict) else False

        if mode == "selector" and exists:
            return
        if mode == "visible" and visible:
            return
        if mode == "hidden" and (not exists or not visible):
            return

        time.sleep(0.1)

    raise BrowserToolsError("Timed out waiting for condition")


def wait_for_condition(input_data: WaitInput, argv: list[str]) -> WaitResult:
    started = time.monotonic()

    if input_data.mode.kind == "delay":
        time.sleep((input_data.mode.ms or 0) / 1000.0)
        return WaitResult(mode="delay", elapsed_ms=int((time.monotonic() - started) * 1000))

    conn = connect_active_page(argv)
    try:
        if input_data.mode.kind in ("selector", "visible", "hidden"):
            _wait_for_selector(conn, input_data.mode.selector or "", input_data.timeout_ms, input_data.mode.kind)
            return WaitResult(mode=input_data.mode.kind, elapsed_ms=int((time.monotonic() - started) * 1000))

        if input_data.mode.kind == "nav":
            initial_url = str(conn.session.evaluate("location.href"))
            initial_time_origin = float(conn.session.evaluate("performance.timeOrigin"))
            deadline = time.monotonic() + input_data.timeout_ms / 1000.0
            while time.monotonic() < deadline:
                current_url = str(conn.session.evaluate("location.href"))
                time_origin = float(conn.session.evaluate("performance.timeOrigin"))
                ready = str(conn.session.evaluate("document.readyState"))
                if (current_url != initial_url or time_origin > initial_time_origin + 1) and ready in ("interactive", "complete"):
                    return WaitResult(
                        mode="nav",
                        elapsed_ms=int((time.monotonic() - started) * 1000),
                        url=current_url,
                    )
                time.sleep(0.1)
            raise BrowserToolsError("Timed out waiting for navigation")

        wait_for_network_idle(conn.session, timeout_ms=input_data.timeout_ms, idle_ms=500)
        return WaitResult(mode="idle", elapsed_ms=int((time.monotonic() - started) * 1000))
    finally:
        conn.close()


def run_wait_cli() -> int:
    argv = os.sys.argv[1:]
    if has_flag(argv, "--help") or has_flag(argv, "-h"):
        usage()
        return 0

    timeout_raw = get_flag_value(argv, "--timeout")
    try:
        timeout_ms = int(timeout_raw) if timeout_raw else 30000
    except ValueError as exc:
        raise BrowserToolsError(f"Invalid --timeout value: {timeout_raw}") from exc
    if timeout_ms <= 0:
        raise BrowserToolsError(f"Invalid --timeout value: {timeout_raw}")

    mode = _parse_wait_mode(argv)
    if not mode:
        usage()
        raise BrowserToolsError("Specify exactly one wait mode")

    result = wait_for_condition(WaitInput(mode=mode, timeout_ms=timeout_ms), argv)
    if result.mode == "delay":
        print(f"✓ Waited {result.elapsed_ms}ms")
    elif result.mode == "selector":
        print(f'✓ Element "{mode.selector}" appeared ({result.elapsed_ms}ms)')
    elif result.mode == "visible":
        print(f'✓ Element "{mode.selector}" is visible ({result.elapsed_ms}ms)')
    elif result.mode == "hidden":
        print(f'✓ Element "{mode.selector}" is hidden/gone ({result.elapsed_ms}ms)')
    elif result.mode == "nav":
        print(f"✓ Navigation complete ({result.elapsed_ms}ms) → {result.url}")
    else:
        print(f"✓ Network idle ({result.elapsed_ms}ms)")
    return 0


if __name__ == "__main__":
    run_cli(run_wait_cli)
