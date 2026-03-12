from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_api_keys_body import PostApiKeysBody
from ...models.post_api_keys_response_201 import PostApiKeysResponse201
from ...models.post_api_keys_response_400 import PostApiKeysResponse400
from ...types import UNSET, Response, Unset


def _get_kwargs(
    *,
    body: PostApiKeysBody | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api-keys",
    }

    if not isinstance(body, Unset):
        _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> PostApiKeysResponse201 | PostApiKeysResponse400 | None:
    if response.status_code == 201:
        response_201 = PostApiKeysResponse201.from_dict(response.json())

        return response_201

    if response.status_code == 400:
        response_400 = PostApiKeysResponse400.from_dict(response.json())

        return response_400

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[PostApiKeysResponse201 | PostApiKeysResponse400]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient,
    body: PostApiKeysBody | Unset = UNSET,
) -> Response[PostApiKeysResponse201 | PostApiKeysResponse400]:
    """Create API key

    Args:
        body (PostApiKeysBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiKeysResponse201 | PostApiKeysResponse400]
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
    body: PostApiKeysBody | Unset = UNSET,
) -> PostApiKeysResponse201 | PostApiKeysResponse400 | None:
    """Create API key

    Args:
        body (PostApiKeysBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiKeysResponse201 | PostApiKeysResponse400
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: PostApiKeysBody | Unset = UNSET,
) -> Response[PostApiKeysResponse201 | PostApiKeysResponse400]:
    """Create API key

    Args:
        body (PostApiKeysBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiKeysResponse201 | PostApiKeysResponse400]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    body: PostApiKeysBody | Unset = UNSET,
) -> PostApiKeysResponse201 | PostApiKeysResponse400 | None:
    """Create API key

    Args:
        body (PostApiKeysBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiKeysResponse201 | PostApiKeysResponse400
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
