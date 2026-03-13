from http import HTTPStatus
from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_images_image_id_variants_response_200 import (
    GetImagesImageIdVariantsResponse200,
)
from ...models.get_images_image_id_variants_response_404 import (
    GetImagesImageIdVariantsResponse404,
)
from ...types import Response


def _get_kwargs(
    image_id: str,
) -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/images/{image_id}/variants".format(
            image_id=quote(str(image_id), safe=""),
        ),
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> GetImagesImageIdVariantsResponse200 | GetImagesImageIdVariantsResponse404 | None:
    if response.status_code == 200:
        response_200 = GetImagesImageIdVariantsResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 404:
        response_404 = GetImagesImageIdVariantsResponse404.from_dict(response.json())

        return response_404

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    GetImagesImageIdVariantsResponse200 | GetImagesImageIdVariantsResponse404
]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    image_id: str,
    *,
    client: AuthenticatedClient,
) -> Response[
    GetImagesImageIdVariantsResponse200 | GetImagesImageIdVariantsResponse404
]:
    """List image variants

    Args:
        image_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetImagesImageIdVariantsResponse200 | GetImagesImageIdVariantsResponse404]
    """

    kwargs = _get_kwargs(
        image_id=image_id,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    image_id: str,
    *,
    client: AuthenticatedClient,
) -> GetImagesImageIdVariantsResponse200 | GetImagesImageIdVariantsResponse404 | None:
    """List image variants

    Args:
        image_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetImagesImageIdVariantsResponse200 | GetImagesImageIdVariantsResponse404
    """

    return sync_detailed(
        image_id=image_id,
        client=client,
    ).parsed


async def asyncio_detailed(
    image_id: str,
    *,
    client: AuthenticatedClient,
) -> Response[
    GetImagesImageIdVariantsResponse200 | GetImagesImageIdVariantsResponse404
]:
    """List image variants

    Args:
        image_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetImagesImageIdVariantsResponse200 | GetImagesImageIdVariantsResponse404]
    """

    kwargs = _get_kwargs(
        image_id=image_id,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    image_id: str,
    *,
    client: AuthenticatedClient,
) -> GetImagesImageIdVariantsResponse200 | GetImagesImageIdVariantsResponse404 | None:
    """List image variants

    Args:
        image_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetImagesImageIdVariantsResponse200 | GetImagesImageIdVariantsResponse404
    """

    return (
        await asyncio_detailed(
            image_id=image_id,
            client=client,
        )
    ).parsed
