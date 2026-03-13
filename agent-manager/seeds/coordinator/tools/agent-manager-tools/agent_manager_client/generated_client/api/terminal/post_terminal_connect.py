from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_terminal_connect_body_type_0 import PostTerminalConnectBodyType0
from ...models.post_terminal_connect_body_type_1 import PostTerminalConnectBodyType1
from ...models.post_terminal_connect_response_200 import PostTerminalConnectResponse200
from ...models.post_terminal_connect_response_400 import PostTerminalConnectResponse400
from ...models.post_terminal_connect_response_404 import PostTerminalConnectResponse404
from ...models.post_terminal_connect_response_409 import PostTerminalConnectResponse409
from ...models.post_terminal_connect_response_502 import PostTerminalConnectResponse502
from ...types import UNSET, Response, Unset


def _get_kwargs(
    *,
    body: PostTerminalConnectBodyType0 | PostTerminalConnectBodyType1 | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/terminal/connect",
    }

    if isinstance(body, PostTerminalConnectBodyType0):
        _kwargs["json"] = body.to_dict()
    else:
        _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    PostTerminalConnectResponse200
    | PostTerminalConnectResponse400
    | PostTerminalConnectResponse404
    | PostTerminalConnectResponse409
    | PostTerminalConnectResponse502
    | None
):
    if response.status_code == 200:
        response_200 = PostTerminalConnectResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = PostTerminalConnectResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 404:
        response_404 = PostTerminalConnectResponse404.from_dict(response.json())

        return response_404

    if response.status_code == 409:
        response_409 = PostTerminalConnectResponse409.from_dict(response.json())

        return response_409

    if response.status_code == 502:
        response_502 = PostTerminalConnectResponse502.from_dict(response.json())

        return response_502

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PostTerminalConnectResponse200
    | PostTerminalConnectResponse400
    | PostTerminalConnectResponse404
    | PostTerminalConnectResponse409
    | PostTerminalConnectResponse502
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
    body: PostTerminalConnectBodyType0 | PostTerminalConnectBodyType1 | Unset = UNSET,
) -> Response[
    PostTerminalConnectResponse200
    | PostTerminalConnectResponse400
    | PostTerminalConnectResponse404
    | PostTerminalConnectResponse409
    | PostTerminalConnectResponse502
]:
    """Create direct terminal connect credentials

    Args:
        body (PostTerminalConnectBodyType0 | PostTerminalConnectBodyType1 | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostTerminalConnectResponse200 | PostTerminalConnectResponse400 | PostTerminalConnectResponse404 | PostTerminalConnectResponse409 | PostTerminalConnectResponse502]
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
    body: PostTerminalConnectBodyType0 | PostTerminalConnectBodyType1 | Unset = UNSET,
) -> (
    PostTerminalConnectResponse200
    | PostTerminalConnectResponse400
    | PostTerminalConnectResponse404
    | PostTerminalConnectResponse409
    | PostTerminalConnectResponse502
    | None
):
    """Create direct terminal connect credentials

    Args:
        body (PostTerminalConnectBodyType0 | PostTerminalConnectBodyType1 | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostTerminalConnectResponse200 | PostTerminalConnectResponse400 | PostTerminalConnectResponse404 | PostTerminalConnectResponse409 | PostTerminalConnectResponse502
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: PostTerminalConnectBodyType0 | PostTerminalConnectBodyType1 | Unset = UNSET,
) -> Response[
    PostTerminalConnectResponse200
    | PostTerminalConnectResponse400
    | PostTerminalConnectResponse404
    | PostTerminalConnectResponse409
    | PostTerminalConnectResponse502
]:
    """Create direct terminal connect credentials

    Args:
        body (PostTerminalConnectBodyType0 | PostTerminalConnectBodyType1 | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostTerminalConnectResponse200 | PostTerminalConnectResponse400 | PostTerminalConnectResponse404 | PostTerminalConnectResponse409 | PostTerminalConnectResponse502]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    body: PostTerminalConnectBodyType0 | PostTerminalConnectBodyType1 | Unset = UNSET,
) -> (
    PostTerminalConnectResponse200
    | PostTerminalConnectResponse400
    | PostTerminalConnectResponse404
    | PostTerminalConnectResponse409
    | PostTerminalConnectResponse502
    | None
):
    """Create direct terminal connect credentials

    Args:
        body (PostTerminalConnectBodyType0 | PostTerminalConnectBodyType1 | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostTerminalConnectResponse200 | PostTerminalConnectResponse400 | PostTerminalConnectResponse404 | PostTerminalConnectResponse409 | PostTerminalConnectResponse502
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
