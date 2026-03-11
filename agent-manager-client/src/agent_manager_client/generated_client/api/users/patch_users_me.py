from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.patch_users_me_body import PatchUsersMeBody
from ...models.patch_users_me_response_200 import PatchUsersMeResponse200
from ...models.patch_users_me_response_404 import PatchUsersMeResponse404
from ...types import UNSET, Response, Unset


def _get_kwargs(
    *,
    body: PatchUsersMeBody | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "patch",
        "url": "/users/me",
    }

    if not isinstance(body, Unset):
        _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> PatchUsersMeResponse200 | PatchUsersMeResponse404 | None:
    if response.status_code == 200:
        response_200 = PatchUsersMeResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 404:
        response_404 = PatchUsersMeResponse404.from_dict(response.json())

        return response_404

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[PatchUsersMeResponse200 | PatchUsersMeResponse404]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient,
    body: PatchUsersMeBody | Unset = UNSET,
) -> Response[PatchUsersMeResponse200 | PatchUsersMeResponse404]:
    """Update current user

    Args:
        body (PatchUsersMeBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PatchUsersMeResponse200 | PatchUsersMeResponse404]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient,
    body: PatchUsersMeBody | Unset = UNSET,
) -> PatchUsersMeResponse200 | PatchUsersMeResponse404 | None:
    """Update current user

    Args:
        body (PatchUsersMeBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PatchUsersMeResponse200 | PatchUsersMeResponse404
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: PatchUsersMeBody | Unset = UNSET,
) -> Response[PatchUsersMeResponse200 | PatchUsersMeResponse404]:
    """Update current user

    Args:
        body (PatchUsersMeBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PatchUsersMeResponse200 | PatchUsersMeResponse404]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    body: PatchUsersMeBody | Unset = UNSET,
) -> PatchUsersMeResponse200 | PatchUsersMeResponse404 | None:
    """Update current user

    Args:
        body (PatchUsersMeBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PatchUsersMeResponse200 | PatchUsersMeResponse404
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
