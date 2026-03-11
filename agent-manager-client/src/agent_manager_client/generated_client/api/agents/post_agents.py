from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_agents_body import PostAgentsBody
from ...models.post_agents_response_201 import PostAgentsResponse201
from ...models.post_agents_response_409 import PostAgentsResponse409
from ...types import UNSET, Response, Unset


def _get_kwargs(
    *,
    body: PostAgentsBody | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/agents",
    }

    if not isinstance(body, Unset):
        _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> PostAgentsResponse201 | PostAgentsResponse409 | None:
    if response.status_code == 201:
        response_201 = PostAgentsResponse201.from_dict(response.json())

        return response_201

    if response.status_code == 409:
        response_409 = PostAgentsResponse409.from_dict(response.json())

        return response_409

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[PostAgentsResponse201 | PostAgentsResponse409]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient,
    body: PostAgentsBody | Unset = UNSET,
) -> Response[PostAgentsResponse201 | PostAgentsResponse409]:
    """Create agent

    Args:
        body (PostAgentsBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostAgentsResponse201 | PostAgentsResponse409]
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
    body: PostAgentsBody | Unset = UNSET,
) -> PostAgentsResponse201 | PostAgentsResponse409 | None:
    """Create agent

    Args:
        body (PostAgentsBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostAgentsResponse201 | PostAgentsResponse409
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: PostAgentsBody | Unset = UNSET,
) -> Response[PostAgentsResponse201 | PostAgentsResponse409]:
    """Create agent

    Args:
        body (PostAgentsBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostAgentsResponse201 | PostAgentsResponse409]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    body: PostAgentsBody | Unset = UNSET,
) -> PostAgentsResponse201 | PostAgentsResponse409 | None:
    """Create agent

    Args:
        body (PostAgentsBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostAgentsResponse201 | PostAgentsResponse409
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
