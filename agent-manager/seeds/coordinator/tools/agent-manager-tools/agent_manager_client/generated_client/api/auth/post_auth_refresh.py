from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_auth_refresh_response_200 import PostAuthRefreshResponse200
from ...models.post_auth_refresh_response_401 import PostAuthRefreshResponse401
from ...types import Response


def _get_kwargs() -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/auth/refresh",
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> PostAuthRefreshResponse200 | PostAuthRefreshResponse401 | None:
    if response.status_code == 200:
        response_200 = PostAuthRefreshResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 401:
        response_401 = PostAuthRefreshResponse401.from_dict(response.json())

        return response_401

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[PostAuthRefreshResponse200 | PostAuthRefreshResponse401]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient | Client,
) -> Response[PostAuthRefreshResponse200 | PostAuthRefreshResponse401]:
    """Refresh access token

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostAuthRefreshResponse200 | PostAuthRefreshResponse401]
    """

    kwargs = _get_kwargs()

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient | Client,
) -> PostAuthRefreshResponse200 | PostAuthRefreshResponse401 | None:
    """Refresh access token

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostAuthRefreshResponse200 | PostAuthRefreshResponse401
    """

    return sync_detailed(
        client=client,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
) -> Response[PostAuthRefreshResponse200 | PostAuthRefreshResponse401]:
    """Refresh access token

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostAuthRefreshResponse200 | PostAuthRefreshResponse401]
    """

    kwargs = _get_kwargs()

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient | Client,
) -> PostAuthRefreshResponse200 | PostAuthRefreshResponse401 | None:
    """Refresh access token

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostAuthRefreshResponse200 | PostAuthRefreshResponse401
    """

    return (
        await asyncio_detailed(
            client=client,
        )
    ).parsed
