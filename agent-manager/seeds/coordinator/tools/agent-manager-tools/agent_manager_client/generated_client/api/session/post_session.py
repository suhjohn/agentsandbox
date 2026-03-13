from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_session_body import PostSessionBody
from ...models.post_session_response_201 import PostSessionResponse201
from ...models.post_session_response_404 import PostSessionResponse404
from ...models.post_session_response_409 import PostSessionResponse409
from ...models.post_session_response_502 import PostSessionResponse502
from ...types import UNSET, Response, Unset


def _get_kwargs(
    *,
    body: PostSessionBody | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/session",
    }

    if not isinstance(body, Unset):
        _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    PostSessionResponse201
    | PostSessionResponse404
    | PostSessionResponse409
    | PostSessionResponse502
    | None
):
    if response.status_code == 201:
        response_201 = PostSessionResponse201.from_dict(response.json())

        return response_201

    if response.status_code == 404:
        response_404 = PostSessionResponse404.from_dict(response.json())

        return response_404

    if response.status_code == 409:
        response_409 = PostSessionResponse409.from_dict(response.json())

        return response_409

    if response.status_code == 502:
        response_502 = PostSessionResponse502.from_dict(response.json())

        return response_502

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PostSessionResponse201
    | PostSessionResponse404
    | PostSessionResponse409
    | PostSessionResponse502
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
    body: PostSessionBody | Unset = UNSET,
) -> Response[
    PostSessionResponse201
    | PostSessionResponse404
    | PostSessionResponse409
    | PostSessionResponse502
]:
    """Create an agent, create/fetch its deterministic session, and start the first message run

    Args:
        body (PostSessionBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostSessionResponse201 | PostSessionResponse404 | PostSessionResponse409 | PostSessionResponse502]
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
    body: PostSessionBody | Unset = UNSET,
) -> (
    PostSessionResponse201
    | PostSessionResponse404
    | PostSessionResponse409
    | PostSessionResponse502
    | None
):
    """Create an agent, create/fetch its deterministic session, and start the first message run

    Args:
        body (PostSessionBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostSessionResponse201 | PostSessionResponse404 | PostSessionResponse409 | PostSessionResponse502
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: PostSessionBody | Unset = UNSET,
) -> Response[
    PostSessionResponse201
    | PostSessionResponse404
    | PostSessionResponse409
    | PostSessionResponse502
]:
    """Create an agent, create/fetch its deterministic session, and start the first message run

    Args:
        body (PostSessionBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostSessionResponse201 | PostSessionResponse404 | PostSessionResponse409 | PostSessionResponse502]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    body: PostSessionBody | Unset = UNSET,
) -> (
    PostSessionResponse201
    | PostSessionResponse404
    | PostSessionResponse409
    | PostSessionResponse502
    | None
):
    """Create an agent, create/fetch its deterministic session, and start the first message run

    Args:
        body (PostSessionBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostSessionResponse201 | PostSessionResponse404 | PostSessionResponse409 | PostSessionResponse502
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
