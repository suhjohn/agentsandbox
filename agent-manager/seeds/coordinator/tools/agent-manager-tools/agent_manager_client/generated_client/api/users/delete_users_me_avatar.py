from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.delete_users_me_avatar_response_200 import DeleteUsersMeAvatarResponse200
from ...models.delete_users_me_avatar_response_404 import DeleteUsersMeAvatarResponse404
from ...models.delete_users_me_avatar_response_500 import DeleteUsersMeAvatarResponse500
from ...types import Response


def _get_kwargs() -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "delete",
        "url": "/users/me/avatar",
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    DeleteUsersMeAvatarResponse200
    | DeleteUsersMeAvatarResponse404
    | DeleteUsersMeAvatarResponse500
    | None
):
    if response.status_code == 200:
        response_200 = DeleteUsersMeAvatarResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 404:
        response_404 = DeleteUsersMeAvatarResponse404.from_dict(response.json())

        return response_404

    if response.status_code == 500:
        response_500 = DeleteUsersMeAvatarResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    DeleteUsersMeAvatarResponse200
    | DeleteUsersMeAvatarResponse404
    | DeleteUsersMeAvatarResponse500
]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient,
) -> Response[
    DeleteUsersMeAvatarResponse200
    | DeleteUsersMeAvatarResponse404
    | DeleteUsersMeAvatarResponse500
]:
    """Reset the current user's avatar

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[DeleteUsersMeAvatarResponse200 | DeleteUsersMeAvatarResponse404 | DeleteUsersMeAvatarResponse500]
    """

    kwargs = _get_kwargs()

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient,
) -> (
    DeleteUsersMeAvatarResponse200
    | DeleteUsersMeAvatarResponse404
    | DeleteUsersMeAvatarResponse500
    | None
):
    """Reset the current user's avatar

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        DeleteUsersMeAvatarResponse200 | DeleteUsersMeAvatarResponse404 | DeleteUsersMeAvatarResponse500
    """

    return sync_detailed(
        client=client,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
) -> Response[
    DeleteUsersMeAvatarResponse200
    | DeleteUsersMeAvatarResponse404
    | DeleteUsersMeAvatarResponse500
]:
    """Reset the current user's avatar

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[DeleteUsersMeAvatarResponse200 | DeleteUsersMeAvatarResponse404 | DeleteUsersMeAvatarResponse500]
    """

    kwargs = _get_kwargs()

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
) -> (
    DeleteUsersMeAvatarResponse200
    | DeleteUsersMeAvatarResponse404
    | DeleteUsersMeAvatarResponse500
    | None
):
    """Reset the current user's avatar

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        DeleteUsersMeAvatarResponse200 | DeleteUsersMeAvatarResponse404 | DeleteUsersMeAvatarResponse500
    """

    return (
        await asyncio_detailed(
            client=client,
        )
    ).parsed
