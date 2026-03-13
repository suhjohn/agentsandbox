from __future__ import annotations

from importlib.resources import files
from typing import Any

import httpx

from .generated_client.client import AuthenticatedClient


def _normalize_base_url(base_url: str) -> str:
    return base_url.strip().rstrip("/")


def bearer_client(
    *,
    base_url: str,
    token: str,
    headers: dict[str, str] | None = None,
    timeout: httpx.Timeout | None = None,
    verify_ssl: str | bool | Any = True,
    follow_redirects: bool = False,
    raise_on_unexpected_status: bool = False,
    httpx_args: dict[str, Any] | None = None,
) -> AuthenticatedClient:
    return AuthenticatedClient(
        base_url=_normalize_base_url(base_url),
        token=token.strip(),
        headers=dict(headers or {}),
        timeout=timeout,
        verify_ssl=verify_ssl,
        follow_redirects=follow_redirects,
        raise_on_unexpected_status=raise_on_unexpected_status,
        httpx_args=dict(httpx_args or {}),
    )


def api_key_client(
    *,
    base_url: str,
    api_key: str,
    headers: dict[str, str] | None = None,
    timeout: httpx.Timeout | None = None,
    verify_ssl: str | bool | Any = True,
    follow_redirects: bool = False,
    raise_on_unexpected_status: bool = False,
    httpx_args: dict[str, Any] | None = None,
) -> AuthenticatedClient:
    return AuthenticatedClient(
        base_url=_normalize_base_url(base_url),
        token=api_key.strip(),
        prefix="",
        auth_header_name="X-API-Key",
        headers=dict(headers or {}),
        timeout=timeout,
        verify_ssl=verify_ssl,
        follow_redirects=follow_redirects,
        raise_on_unexpected_status=raise_on_unexpected_status,
        httpx_args=dict(httpx_args or {}),
    )


def openapi_spec_path():
    return files("agent_manager_client").joinpath("openapi.json")
