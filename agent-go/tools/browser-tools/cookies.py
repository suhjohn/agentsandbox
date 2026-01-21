#!/usr/bin/env python3
from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Any, Dict, Literal, Optional

from _shared import BrowserToolsError, connect_active_page, get_flag_value, has_flag, print_result, run_cli


CookieSameSite = Literal["Strict", "Lax", "None"]


@dataclass
class CookieReadInput:
    as_json: bool = False


@dataclass
class CookieSetInput:
    name: str
    value: str
    http_only: bool = False
    secure: bool = False
    domain: str | None = None
    path: str | None = None
    same_site: CookieSameSite | None = None
    from_env_var: str | None = None


@dataclass
class CookieDeleteInput:
    name: str
    domain: str | None = None
    path: str | None = None


def usage() -> None:
    print("Usage: cookies.py [--json]")
    print("       cookies.py --set <name=value> [--httpOnly] [--secure] [--domain d] [--path p] [--sameSite s]")
    print("       cookies.py --set <name> --env <VAR>")
    print("       cookies.py --delete <name>")


def _parse_same_site(value: Optional[str]) -> CookieSameSite | None:
    if not value:
        return None
    if value in ("Strict", "Lax", "None"):
        return value
    raise BrowserToolsError(f"Invalid --sameSite value: {value}")


def _parse_set_input(argv: list[str]) -> CookieSetInput | None:
    raw_set = get_flag_value(argv, "--set")
    if not raw_set:
        return None

    env_var = get_flag_value(argv, "--env")
    http_only = has_flag(argv, "--httpOnly")
    secure = has_flag(argv, "--secure")
    domain = get_flag_value(argv, "--domain")
    path = get_flag_value(argv, "--path")
    same_site = _parse_same_site(get_flag_value(argv, "--sameSite"))

    if env_var:
        env_value = os.environ.get(env_var)
        if not env_value:
            raise BrowserToolsError(f"Environment variable {env_var} is not set or empty")
        return CookieSetInput(
            name=raw_set,
            value=env_value,
            http_only=http_only,
            secure=secure,
            domain=domain,
            path=path,
            same_site=same_site,
            from_env_var=env_var,
        )

    if "=" not in raw_set:
        raise BrowserToolsError("--set requires name=value or --env VAR_NAME")

    name, value = raw_set.split("=", 1)
    return CookieSetInput(
        name=name,
        value=value,
        http_only=http_only,
        secure=secure,
        domain=domain,
        path=path,
        same_site=same_site,
    )


def manage_cookies(input_data: CookieReadInput | CookieSetInput | CookieDeleteInput, argv: list[str]) -> Dict[str, Any]:
    conn = connect_active_page(argv)
    try:
        conn.session.call("Network.enable")
        page_url = str(conn.session.evaluate("location.href"))
        page_hostname = str(conn.session.evaluate("location.hostname"))

        if isinstance(input_data, CookieDeleteInput):
            conn.session.call(
                "Network.deleteCookies",
                {
                    "name": input_data.name,
                    "domain": input_data.domain or page_hostname,
                    "path": input_data.path or "/",
                },
            )
            return {"kind": "delete", "name": input_data.name}

        if isinstance(input_data, CookieSetInput):
            params: Dict[str, Any] = {
                "name": input_data.name,
                "value": input_data.value,
                "domain": input_data.domain or page_hostname,
                "path": input_data.path or "/",
                "httpOnly": input_data.http_only,
                "secure": input_data.secure,
            }
            if input_data.same_site:
                params["sameSite"] = input_data.same_site
            conn.session.call("Network.setCookie", params)
            return {
                "kind": "set",
                "name": input_data.name,
                "httpOnly": input_data.http_only,
                "secure": input_data.secure,
                "fromEnvVar": input_data.from_env_var,
            }

        response = conn.session.call("Network.getCookies", {"urls": [page_url]})
        cookies = response.get("cookies") if isinstance(response.get("cookies"), list) else []
        return {
            "kind": "read",
            "url": page_url,
            "cookies": cookies,
            "asJson": input_data.as_json,
        }
    finally:
        conn.close()


def run_cookies_cli() -> int:
    argv = os.sys.argv[1:]
    if has_flag(argv, "--help") or has_flag(argv, "-h"):
        usage()
        return 0

    delete_name = get_flag_value(argv, "--delete")
    set_input = _parse_set_input(argv)

    if delete_name:
        input_data = CookieDeleteInput(
            name=delete_name,
            domain=get_flag_value(argv, "--domain"),
            path=get_flag_value(argv, "--path"),
        )
    elif set_input:
        input_data = set_input
    else:
        input_data = CookieReadInput(as_json=has_flag(argv, "--json"))

    result = manage_cookies(input_data, argv)

    if result["kind"] == "delete":
        print(f"✓ Deleted cookie \"{result['name']}\"")
        return 0

    if result["kind"] == "set":
        if result.get("fromEnvVar"):
            print(
                f"✓ Set cookie \"{result['name']}\" from ${result['fromEnvVar']} "
                f"(httpOnly={result['httpOnly']}, secure={result['secure']})"
            )
        else:
            print(
                f"✓ Set cookie \"{result['name']}\" "
                f"(httpOnly={result['httpOnly']}, secure={result['secure']})"
            )
        return 0

    if result.get("asJson"):
        print(json.dumps({"url": result["url"], "cookies": result["cookies"]}, indent=2))
    else:
        print_result(result["cookies"])
    return 0


if __name__ == "__main__":
    run_cli(run_cookies_cli)
