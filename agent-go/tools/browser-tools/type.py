#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass

from _shared import (
    BrowserToolsError,
    connect_active_page,
    get_flag_value,
    has_flag,
    positional_args,
    preview_text,
    run_cli,
)


@dataclass
class TypeInput:
    selector: str | None = None
    text: str | None = None
    clear: bool = False
    press_key: str | None = None
    delay_ms: int = 0


@dataclass
class TypeResult:
    selector: str | None
    mode: str
    press_key: str | None = None
    typed_length: int | None = None


def usage() -> None:
    print("Usage: type.py <text> [--selector sel] [--clear] [--press key] [--delay ms]")
    print("       type.py --env <VAR_NAME> [--selector sel] [--clear] [--delay ms]")


def _focus_selector(conn, selector: str) -> None:
    selector_json = json.dumps(selector)
    found = conn.session.evaluate(
        f"(() => {{ const el = document.querySelector({selector_json}); if (!el) return false; el.focus(); return true; }})()"
    )
    if not found:
        raise BrowserToolsError(f"No element matches selector: {selector}")


def _clear_active_element(conn) -> None:
    # Mimic Ctrl/Cmd+A + Backspace using JS fallback to work in most pages.
    conn.session.evaluate(
        "(() => {"
        "const el = document.activeElement;"
        "if (!el) return;"
        "if ('value' in el) {"
        "  el.value = '';"
        "  el.dispatchEvent(new Event('input', { bubbles: true }));"
        "  el.dispatchEvent(new Event('change', { bubbles: true }));"
        "}"
        "})()",
        await_promise=False,
        return_by_value=False,
    )


def _press_key(conn, key: str) -> None:
    key_map = {
        "Enter": ("\r", 13),
        "Tab": ("\t", 9),
        "Escape": ("", 27),
        "Backspace": ("", 8),
        "ArrowDown": ("", 40),
        "ArrowUp": ("", 38),
        "ArrowLeft": ("", 37),
        "ArrowRight": ("", 39),
    }
    text, key_code = key_map.get(key, ("", 0))
    conn.session.call(
        "Input.dispatchKeyEvent",
        {"type": "keyDown", "key": key, "text": text, "windowsVirtualKeyCode": key_code},
    )
    conn.session.call(
        "Input.dispatchKeyEvent",
        {"type": "keyUp", "key": key, "text": text, "windowsVirtualKeyCode": key_code},
    )


def type_into_page(input_data: TypeInput, argv: list[str]) -> TypeResult:
    conn = connect_active_page(argv)
    try:
        if input_data.selector:
            _focus_selector(conn, input_data.selector)

        if input_data.clear:
            _clear_active_element(conn)

        if input_data.press_key:
            _press_key(conn, input_data.press_key)
            return TypeResult(selector=input_data.selector, mode="press", press_key=input_data.press_key)

        if input_data.text is None:
            raise BrowserToolsError("No text provided")

        for char in input_data.text:
            conn.session.call("Input.insertText", {"text": char})
            if input_data.delay_ms > 0:
                time.sleep(input_data.delay_ms / 1000.0)

        return TypeResult(
            selector=input_data.selector,
            mode="text",
            typed_length=len(input_data.text),
        )
    finally:
        conn.close()


def run_type_cli() -> int:
    argv = os.sys.argv[1:]
    if has_flag(argv, "--help") or has_flag(argv, "-h"):
        usage()
        return 0

    selector = get_flag_value(argv, "--selector")
    press_key = get_flag_value(argv, "--press")
    env_var = get_flag_value(argv, "--env")
    clear = has_flag(argv, "--clear")

    delay_raw = get_flag_value(argv, "--delay")
    try:
        delay_ms = int(delay_raw) if delay_raw else 0
    except ValueError as exc:
        raise BrowserToolsError(f"Invalid --delay value: {delay_raw}") from exc
    if delay_ms < 0:
        raise BrowserToolsError(f"Invalid --delay value: {delay_raw}")

    text = " ".join(
        positional_args(
            argv,
            flags_with_value=(
                "--port",
                "--browser-url",
                "--selector",
                "--press",
                "--delay",
                "--env",
            ),
        )
    ).strip()
    text_value = text if text else None

    if env_var:
        env_value = os.environ.get(env_var)
        if not env_value:
            raise BrowserToolsError(f"Environment variable {env_var} is not set or empty")
        text_value = env_value

    if not text_value and not press_key:
        usage()
        return 1

    result = type_into_page(
        TypeInput(
            selector=selector,
            text=text_value,
            clear=clear,
            press_key=press_key,
            delay_ms=delay_ms,
        ),
        argv,
    )

    target = f' on "{result.selector}"' if result.selector else ""
    if result.mode == "press":
        print(f"✓ Pressed {result.press_key}{target}")
        return 0

    if env_var:
        print(f"✓ Typed value of ${env_var}{target}")
    elif text_value is not None:
        print(f'✓ Typed "{preview_text(text_value)}"{target}')
    return 0


if __name__ == "__main__":
    run_cli(run_type_cli)
