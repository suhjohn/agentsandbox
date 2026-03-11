from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_images_archived import GetImagesArchived
from ...models.get_images_response_200 import GetImagesResponse200
from ...types import UNSET, Response, Unset


def _get_kwargs(
    *,
    limit: int | Unset = 20,
    cursor: str | Unset = UNSET,
    archived: GetImagesArchived | Unset = UNSET,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    params["limit"] = limit

    params["cursor"] = cursor

    json_archived: str | Unset = UNSET
    if not isinstance(archived, Unset):
        json_archived = archived.value

    params["archived"] = json_archived

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/images",
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> GetImagesResponse200 | None:
    if response.status_code == 200:
        response_200 = GetImagesResponse200.from_dict(response.json())

        return response_200

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[GetImagesResponse200]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient,
    limit: int | Unset = 20,
    cursor: str | Unset = UNSET,
    archived: GetImagesArchived | Unset = UNSET,
) -> Response[GetImagesResponse200]:
    """List images

    Args:
        limit (int | Unset):  Default: 20.
        cursor (str | Unset):
        archived (GetImagesArchived | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetImagesResponse200]
    """

    kwargs = _get_kwargs(
        limit=limit,
        cursor=cursor,
        archived=archived,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient,
    limit: int | Unset = 20,
    cursor: str | Unset = UNSET,
    archived: GetImagesArchived | Unset = UNSET,
) -> GetImagesResponse200 | None:
    """List images

    Args:
        limit (int | Unset):  Default: 20.
        cursor (str | Unset):
        archived (GetImagesArchived | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetImagesResponse200
    """

    return sync_detailed(
        client=client,
        limit=limit,
        cursor=cursor,
        archived=archived,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    limit: int | Unset = 20,
    cursor: str | Unset = UNSET,
    archived: GetImagesArchived | Unset = UNSET,
) -> Response[GetImagesResponse200]:
    """List images

    Args:
        limit (int | Unset):  Default: 20.
        cursor (str | Unset):
        archived (GetImagesArchived | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetImagesResponse200]
    """

    kwargs = _get_kwargs(
        limit=limit,
        cursor=cursor,
        archived=archived,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    limit: int | Unset = 20,
    cursor: str | Unset = UNSET,
    archived: GetImagesArchived | Unset = UNSET,
) -> GetImagesResponse200 | None:
    """List images

    Args:
        limit (int | Unset):  Default: 20.
        cursor (str | Unset):
        archived (GetImagesArchived | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetImagesResponse200
    """

    return (
        await asyncio_detailed(
            client=client,
            limit=limit,
            cursor=cursor,
            archived=archived,
        )
    ).parsed
