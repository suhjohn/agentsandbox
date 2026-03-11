from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_auth_github_callback_response_400 import (
    GetAuthGithubCallbackResponse400,
)
from ...models.get_auth_github_callback_response_501 import (
    GetAuthGithubCallbackResponse501,
)
from ...types import Response


def _get_kwargs() -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/auth/github/callback",
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Any | GetAuthGithubCallbackResponse400 | GetAuthGithubCallbackResponse501 | None:
    if response.status_code == 200:
        response_200 = response.json()
        return response_200

    if response.status_code == 400:
        response_400 = GetAuthGithubCallbackResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 501:
        response_501 = GetAuthGithubCallbackResponse501.from_dict(response.json())

        return response_501

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    Any | GetAuthGithubCallbackResponse400 | GetAuthGithubCallbackResponse501
]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient | Client,
) -> Response[
    Any | GetAuthGithubCallbackResponse400 | GetAuthGithubCallbackResponse501
]:
    """GitHub OAuth callback

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | GetAuthGithubCallbackResponse400 | GetAuthGithubCallbackResponse501]
    """

    kwargs = _get_kwargs()

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient | Client,
) -> Any | GetAuthGithubCallbackResponse400 | GetAuthGithubCallbackResponse501 | None:
    """GitHub OAuth callback

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | GetAuthGithubCallbackResponse400 | GetAuthGithubCallbackResponse501
    """

    return sync_detailed(
        client=client,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
) -> Response[
    Any | GetAuthGithubCallbackResponse400 | GetAuthGithubCallbackResponse501
]:
    """GitHub OAuth callback

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | GetAuthGithubCallbackResponse400 | GetAuthGithubCallbackResponse501]
    """

    kwargs = _get_kwargs()

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient | Client,
) -> Any | GetAuthGithubCallbackResponse400 | GetAuthGithubCallbackResponse501 | None:
    """GitHub OAuth callback

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | GetAuthGithubCallbackResponse400 | GetAuthGithubCallbackResponse501
    """

    return (
        await asyncio_detailed(
            client=client,
        )
    ).parsed
