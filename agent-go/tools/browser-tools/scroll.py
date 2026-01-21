#!/usr/bin/env python3
from __future__ import annotations

import json
import os
from dataclasses import dataclass

from _shared import BrowserToolsError, connect_active_page, get_flag_value, has_flag, positional_args, run_cli


DIRECTIONS = {"up", "down", "left", "right", "top", "bottom"}


@dataclass
class ScrollInput:
    direction: str | None = None
    pixels: int | None = None
    selector: str | None = None


@dataclass
class ScrollResult:
    direction: str | None
    selector: str | None
    scroll_x: int | None = None
    scroll_y: int | None = None
    page_width: int | None = None
    page_height: int | None = None
    viewport_width: int | None = None
    viewport_height: int | None = None


def usage() -> None:
    print("Usage: scroll.py [direction] [pixels] [--selector sel]")


def scroll_page(input_data: ScrollInput, argv: list[str]) -> ScrollResult:
    conn = connect_active_page(argv)
    try:
        if input_data.selector:
            selector_json = json.dumps(input_data.selector)
            found = conn.session.evaluate(
                "(() => {"
                f"const el = document.querySelector({selector_json});"
                "if (!el) return false;"
                "el.scrollIntoView({ behavior: 'smooth', block: 'center' });"
                "return true;"
                "})()"
            )
            if not found:
                raise BrowserToolsError(f"No element matches selector: {input_data.selector}")
            return ScrollResult(direction=None, selector=input_data.selector)

        direction = input_data.direction or "down"
        pixels = input_data.pixels
        payload = {"direction": direction, "pixels": pixels}
        result = conn.session.evaluate(
            "(({ direction, pixels }) => {"
            "const viewportWidth = window.innerWidth;"
            "const viewportHeight = window.innerHeight;"
            "const pageHeight = document.documentElement.scrollHeight;"
            "const pageWidth = document.documentElement.scrollWidth;"
            "switch (direction) {"
            "case 'down': window.scrollBy({ top: pixels ?? viewportHeight, behavior: 'smooth' }); break;"
            "case 'up': window.scrollBy({ top: -(pixels ?? viewportHeight), behavior: 'smooth' }); break;"
            "case 'right': window.scrollBy({ left: pixels ?? viewportWidth, behavior: 'smooth' }); break;"
            "case 'left': window.scrollBy({ left: -(pixels ?? viewportWidth), behavior: 'smooth' }); break;"
            "case 'top': window.scrollTo({ top: 0, behavior: 'smooth' }); break;"
            "case 'bottom': window.scrollTo({ top: pageHeight, behavior: 'smooth' }); break;"
            "}"
            "return {"
            "scrollX: Math.round(window.scrollX),"
            "scrollY: Math.round(window.scrollY),"
            "pageHeight,"
            "pageWidth,"
            "viewportHeight,"
            "viewportWidth"
            "};"
            "})(" + json.dumps(payload) + ")"
        )

        if not isinstance(result, dict):
            raise BrowserToolsError("Unexpected scroll response")

        return ScrollResult(
            direction=direction,
            selector=None,
            scroll_x=int(result.get("scrollX", 0)),
            scroll_y=int(result.get("scrollY", 0)),
            page_width=int(result.get("pageWidth", 0)),
            page_height=int(result.get("pageHeight", 0)),
            viewport_width=int(result.get("viewportWidth", 0)),
            viewport_height=int(result.get("viewportHeight", 0)),
        )
    finally:
        conn.close()


def run_scroll_cli() -> int:
    argv = os.sys.argv[1:]
    if has_flag(argv, "--help") or has_flag(argv, "-h"):
        usage()
        return 0

    selector = get_flag_value(argv, "--selector")
    args = positional_args(argv, flags_with_value=("--port", "--browser-url", "--selector"))

    direction = (args[0].lower() if args else "down")
    pixels = None
    if len(args) > 1:
        try:
            pixels = int(args[1])
        except ValueError as exc:
            raise BrowserToolsError(f"Invalid pixel value: {args[1]}") from exc
        if pixels <= 0:
            raise BrowserToolsError(f"Invalid pixel value: {args[1]}")

    if not selector and direction not in DIRECTIONS:
        raise BrowserToolsError(f"Unknown direction: {direction}")

    result = scroll_page(ScrollInput(direction=None if selector else direction, pixels=pixels, selector=selector), argv)
    if result.selector:
        print(f'✓ Scrolled "{result.selector}" into view')
        return 0

    if result.direction in ("top", "bottom"):
        label = result.direction
    else:
        label = f"{result.direction} {pixels or (result.viewport_height or 0)}px"
    print(f"✓ Scrolled {label}")
    print(f"  Position: ({result.scroll_x}, {result.scroll_y}) of ({result.page_width} × {result.page_height})")
    return 0


if __name__ == "__main__":
    run_cli(run_scroll_cli)
