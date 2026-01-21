#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass

from _shared import BrowserToolsError, connect_active_page, get_flag_value, has_flag, positional_args, run_cli


@dataclass
class ClickInput:
    selector: str
    right_click: bool = False
    double_click: bool = False
    delay_ms: int = 0


@dataclass
class ClickResult:
    selector: str
    button: str
    click_count: int


def usage() -> None:
    print("Usage: click.py <selector> [--right] [--double] [--delay ms]")


def click_element(input_data: ClickInput, argv: list[str]) -> ClickResult:
    conn = connect_active_page(argv)
    try:
        selector_json = json.dumps(input_data.selector)
        point = conn.session.evaluate(
            "(() => {"
            f"const el = document.querySelector({selector_json});"
            "if (!el) return null;"
            "el.scrollIntoView({ block: 'center', behavior: 'instant' });"
            "const r = el.getBoundingClientRect();"
            "return { x: r.left + (r.width / 2), y: r.top + (r.height / 2) };"
            "})()"
        )
        if not isinstance(point, dict) or "x" not in point or "y" not in point:
            raise BrowserToolsError(f"No element matches selector: {input_data.selector}")

        if input_data.delay_ms > 0:
            time.sleep(input_data.delay_ms / 1000.0)

        button = "right" if input_data.right_click else "left"
        click_count = 2 if input_data.double_click else 1

        conn.session.call(
            "Input.dispatchMouseEvent",
            {"type": "mouseMoved", "x": point["x"], "y": point["y"], "button": button},
        )
        conn.session.call(
            "Input.dispatchMouseEvent",
            {
                "type": "mousePressed",
                "x": point["x"],
                "y": point["y"],
                "button": button,
                "clickCount": click_count,
            },
        )
        conn.session.call(
            "Input.dispatchMouseEvent",
            {
                "type": "mouseReleased",
                "x": point["x"],
                "y": point["y"],
                "button": button,
                "clickCount": click_count,
            },
        )

        return ClickResult(selector=input_data.selector, button=button, click_count=click_count)
    finally:
        conn.close()


def run_click_cli() -> int:
    argv = os.sys.argv[1:]
    if has_flag(argv, "--help") or has_flag(argv, "-h"):
        usage()
        return 0

    selectors = positional_args(argv, flags_with_value=("--port", "--browser-url", "--delay"))
    selector = selectors[0] if selectors else ""
    if not selector:
        usage()
        return 1

    delay_raw = get_flag_value(argv, "--delay")
    try:
        delay_ms = int(delay_raw) if delay_raw else 0
    except ValueError as exc:
        raise BrowserToolsError(f"Invalid --delay value: {delay_raw}") from exc
    if delay_ms < 0:
        raise BrowserToolsError(f"Invalid --delay value: {delay_raw}")

    result = click_element(
        ClickInput(
            selector=selector,
            right_click=has_flag(argv, "--right"),
            double_click=has_flag(argv, "--double"),
            delay_ms=delay_ms,
        ),
        argv,
    )

    kind = "Right-clicked" if result.button == "right" else "Double-clicked" if result.click_count == 2 else "Clicked"
    print(f'✓ {kind} "{result.selector}"')
    return 0


if __name__ == "__main__":
    run_cli(run_click_cli)
