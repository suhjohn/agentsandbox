#!/usr/bin/env python3
from __future__ import annotations

import os
import shutil
import subprocess
import time
import urllib.parse
from dataclasses import dataclass
from pathlib import Path

from _shared import BrowserToolsError, find_chrome_executable, get_browser_url, has_flag, run_cli, wait_for_cdp


@dataclass
class StartBrowserInput:
    use_profile: bool = False
    restart: bool = False


@dataclass
class StartBrowserResult:
    browser_url: str
    container_managed: bool
    already_running: bool = False
    started: bool = False
    profile_copied: bool = False
    novnc_port: str | None = None


def usage() -> None:
    print("Usage: start.py [--profile] [--restart]")
    print("\nOptions:")
    print(" --profile   Copy your default Chrome profile (cookies, logins)")
    print(" --restart   Kill existing Chrome before starting")


def _kill_chrome_processes() -> None:
    for command in (
        "pkill -TERM -x chromium 2>/dev/null || true",
        "pkill -TERM -x chromium-browser 2>/dev/null || true",
        "pkill -TERM -x google-chrome 2>/dev/null || true",
        "pkill -TERM -x google-chrome-stable 2>/dev/null || true",
    ):
        subprocess.run(["bash", "-lc", command], check=False)


def _copy_profile(profile_src: Path, user_data_dir: Path) -> None:
    if not profile_src.exists():
        raise BrowserToolsError(f"Chrome profile source does not exist: {profile_src}")
    user_data_dir.mkdir(parents=True, exist_ok=True)
    rsync = shutil.which("rsync")
    if rsync:
        subprocess.run(
            [rsync, "-a", "--delete", f"{profile_src}/", f"{user_data_dir}/"],
            check=True,
        )
        return

    # Fallback without rsync: best-effort full copy.
    if user_data_dir.exists():
        shutil.rmtree(user_data_dir)
    shutil.copytree(profile_src, user_data_dir)


def ensure_browser_started(input_data: StartBrowserInput, argv: list[str]) -> StartBrowserResult:
    browser_url = get_browser_url(argv)
    parsed_browser_url = urllib.parse.urlparse(browser_url)
    requested_host = parsed_browser_url.hostname or ""
    requested_port = parsed_browser_url.port

    is_likely_agent_container = all(
        os.environ.get(name)
        for name in (
            "NOVNC_PORT",
            "VNC_PORT",
            "CHROMIUM_REMOTE_DEBUG_PORT",
            "CHROMIUM_USER_DATA_DIR",
        )
    )

    if is_likely_agent_container:
        if input_data.restart:
            _kill_chrome_processes()
        if not wait_for_cdp(browser_url):
            raise BrowserToolsError(
                f"Failed to connect to Chromium DevTools on {browser_url}. "
                "In the container, Chromium is started by docker/entrypoint.sh."
            )
        return StartBrowserResult(
            browser_url=browser_url,
            container_managed=True,
            started=True,
            novnc_port=os.environ.get("NOVNC_PORT"),
        )

    chrome_path = os.environ.get("CHROME_PATH")
    if os.uname().sysname.lower() == "darwin" and not chrome_path:
        chrome_path = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

    chrome_executable = find_chrome_executable(chrome_path)
    if not chrome_executable:
        raise BrowserToolsError("Could not find Chrome. Set CHROME_PATH or install Chrome/Chromium.")

    if requested_host and requested_host not in ("localhost", "127.0.0.1", "::1"):
        raise BrowserToolsError(
            f"Refusing to start a local Chrome for non-local --browser-url host: {requested_host}. "
            "Use --browser-url only to connect to an already-running browser, or omit it to start locally."
        )
    if requested_port is not None:
        port = requested_port
    else:
        port_raw = os.environ.get("BROWSER_TOOLS_PORT") or "9222"
        try:
            port = int(port_raw)
        except ValueError as exc:
            raise BrowserToolsError(f"Invalid BROWSER_TOOLS_PORT value: {port_raw}") from exc
    if port <= 0:
        raise BrowserToolsError(f"Invalid browser debugging port: {port}")
    user_data_dir = Path(os.environ.get("CHROME_USER_DATA_DIR") or f"{Path.home()}/.cache/browser-tools/{port}")

    if not input_data.restart and wait_for_cdp(browser_url, retries=1):
        return StartBrowserResult(browser_url=browser_url, container_managed=False, already_running=True)

    if input_data.restart:
        _kill_chrome_processes()
        time.sleep(1.0)

    profile_copied = False
    if input_data.use_profile:
        profile_src_raw = os.environ.get("CHROME_PROFILE_SRC")
        if profile_src_raw:
            profile_src = Path(profile_src_raw)
        elif os.uname().sysname.lower() == "darwin":
            profile_src = Path.home() / "Library" / "Application Support" / "Google" / "Chrome"
        else:
            profile_src = Path.home() / ".config" / "google-chrome"
        _copy_profile(profile_src, user_data_dir)
        profile_copied = True

    user_data_dir.mkdir(parents=True, exist_ok=True)
    subprocess.Popen(  # noqa: S603
        [
            chrome_executable,
            f"--remote-debugging-port={port}",
            f"--user-data-dir={user_data_dir}",
            "--no-first-run",
            "--no-default-browser-check",
        ],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )

    if not wait_for_cdp(browser_url):
        raise BrowserToolsError(f"Failed to connect to Chrome on {browser_url}")

    return StartBrowserResult(
        browser_url=browser_url,
        container_managed=False,
        started=True,
        profile_copied=profile_copied,
    )


def run_start_cli() -> int:
    argv = os.sys.argv[1:]
    if has_flag(argv, "--help") or has_flag(argv, "-h"):
        usage()
        return 0

    result = ensure_browser_started(
        StartBrowserInput(
            use_profile=has_flag(argv, "--profile"),
            restart=has_flag(argv, "--restart"),
        ),
        argv,
    )

    if result.container_managed:
        suffix = f" (noVNC is on port {result.novnc_port})" if result.novnc_port else ""
        print(f"✓ Chromium ready on {result.browser_url}{suffix}")
        return 0

    if result.already_running:
        print(f"✓ Chrome already running on {result.browser_url}")
        return 0

    copied = " (profile copied)" if result.profile_copied else ""
    print(f"✓ Chrome started on {result.browser_url}{copied}")
    return 0


if __name__ == "__main__":
    run_cli(run_start_cli)
