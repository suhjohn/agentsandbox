#!/usr/bin/env python3
from __future__ import annotations

import base64
import os
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path

from _shared import BrowserToolsError, connect_active_page, get_flag_value, has_flag, run_cli


@dataclass
class ScreenshotArgs:
    output_path: str | None = None


@dataclass
class ScreenshotResult:
    path: str


def usage() -> None:
    print("Usage: screenshot.py [--path /tmp/file.png]")


def capture_screenshot(args: ScreenshotArgs, argv: list[str]) -> ScreenshotResult:
    conn = connect_active_page(argv)
    try:
        try:
            conn.browser_http.activate_target(conn.target.id)
        except Exception:  # noqa: BLE001
            pass

        if args.output_path:
            output_path = Path(args.output_path)
        else:
            stamp = time.strftime("%Y%m%d-%H%M%S")
            output_path = Path(tempfile.gettempdir()) / f"screenshot-{stamp}.png"

        result = conn.session.call("Page.captureScreenshot", {"format": "png"})
        data = result.get("data")
        if not isinstance(data, str):
            raise BrowserToolsError("Screenshot capture failed")
        output_path.write_bytes(base64.b64decode(data))
        return ScreenshotResult(path=str(output_path))
    finally:
        conn.close()


def run_screenshot_cli() -> int:
    argv = os.sys.argv[1:]
    if has_flag(argv, "--help") or has_flag(argv, "-h"):
        usage()
        return 0

    output_path = get_flag_value(argv, "--path")
    if "--path" in argv and not output_path:
        raise BrowserToolsError("--path requires a value")

    result = capture_screenshot(ScreenshotArgs(output_path=output_path), argv)
    print(result.path)
    return 0


if __name__ == "__main__":
    run_cli(run_screenshot_cli)
