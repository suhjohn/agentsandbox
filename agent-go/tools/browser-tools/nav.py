#!/usr/bin/env python3
from __future__ import annotations

import os
from dataclasses import dataclass

from _shared import BrowserToolsError, connect_active_page, has_flag, positional_args, run_cli, wait_for_document_ready


@dataclass
class NavigateArgs:
    url: str
    new_tab: bool = False


@dataclass
class NavigateResult:
    url: str
    new_tab: bool


def usage() -> None:
    print("Usage: nav.py <url> [--new]")


def navigate_to(args: NavigateArgs, argv: list[str]) -> NavigateResult:
    conn = connect_active_page(argv, new_tab=args.new_tab, new_tab_url="about:blank")
    try:
        conn.session.call("Page.navigate", {"url": args.url})
        wait_for_document_ready(conn.session)
        return NavigateResult(url=args.url, new_tab=args.new_tab)
    finally:
        conn.close()


def run_nav_cli() -> int:
    argv = os.sys.argv[1:]
    if has_flag(argv, "--help") or has_flag(argv, "-h"):
        usage()
        return 0

    url = positional_args(argv)[0] if positional_args(argv) else ""
    if not url:
        usage()
        return 1

    result = navigate_to(NavigateArgs(url=url, new_tab=has_flag(argv, "--new")), argv)
    if result.new_tab:
        print(f"✓ Opened: {result.url}")
    else:
        print(f"✓ Navigated to: {result.url}")
    return 0


if __name__ == "__main__":
    run_cli(run_nav_cli)
