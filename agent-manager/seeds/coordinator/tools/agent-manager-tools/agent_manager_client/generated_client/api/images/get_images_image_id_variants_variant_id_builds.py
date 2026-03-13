from http import HTTPStatus
from typing import Any
from urllib.parse import quote
from uuid import UUID

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_images_image_id_variants_variant_id_builds_response_200 import (
    GetImagesImageIdVariantsVariantIdBuildsResponse200,
)
from ...models.get_images_image_id_variants_variant_id_builds_response_404 import (
    GetImagesImageIdVariantsVariantIdBuildsResponse404,
)
from ...types import UNSET, Response, Unset


def _get_kwargs(
    image_id: str,
    variant_id: UUID,
    *,
    limit: int | Unset = 20,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    params["limit"] = limit

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/images/{image_id}/variants/{variant_id}/builds".format(
            image_id=quote(str(image_id), safe=""),
            variant_id=quote(str(variant_id), safe=""),
        ),
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    GetImagesImageIdVariantsVariantIdBuildsResponse200
    | GetImagesImageIdVariantsVariantIdBuildsResponse404
    | None
):
    if response.status_code == 200:
        response_200 = GetImagesImageIdVariantsVariantIdBuildsResponse200.from_dict(
            response.json()
        )

        return response_200

    if response.status_code == 404:
        response_404 = GetImagesImageIdVariantsVariantIdBuildsResponse404.from_dict(
            response.json()
        )

        return response_404

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    GetImagesImageIdVariantsVariantIdBuildsResponse200
    | GetImagesImageIdVariantsVariantIdBuildsResponse404
]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    image_id: str,
    variant_id: UUID,
    *,
    client: AuthenticatedClient,
    limit: int | Unset = 20,
) -> Response[
    GetImagesImageIdVariantsVariantIdBuildsResponse200
    | GetImagesImageIdVariantsVariantIdBuildsResponse404
]:
    """List image variant builds

    Args:
        image_id (str):
        variant_id (UUID):
        limit (int | Unset):  Default: 20.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetImagesImageIdVariantsVariantIdBuildsResponse200 | GetImagesImageIdVariantsVariantIdBuildsResponse404]
    """

    kwargs = _get_kwargs(
        image_id=image_id,
        variant_id=variant_id,
        limit=limit,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    image_id: str,
    variant_id: UUID,
    *,
    client: AuthenticatedClient,
    limit: int | Unset = 20,
) -> (
    GetImagesImageIdVariantsVariantIdBuildsResponse200
    | GetImagesImageIdVariantsVariantIdBuildsResponse404
    | None
):
    """List image variant builds

    Args:
        image_id (str):
        variant_id (UUID):
        limit (int | Unset):  Default: 20.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetImagesImageIdVariantsVariantIdBuildsResponse200 | GetImagesImageIdVariantsVariantIdBuildsResponse404
    """

    return sync_detailed(
        image_id=image_id,
        variant_id=variant_id,
        client=client,
        limit=limit,
    ).parsed


async def asyncio_detailed(
    image_id: str,
    variant_id: UUID,
    *,
    client: AuthenticatedClient,
    limit: int | Unset = 20,
) -> Response[
    GetImagesImageIdVariantsVariantIdBuildsResponse200
    | GetImagesImageIdVariantsVariantIdBuildsResponse404
]:
    """List image variant builds

    Args:
        image_id (str):
        variant_id (UUID):
        limit (int | Unset):  Default: 20.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetImagesImageIdVariantsVariantIdBuildsResponse200 | GetImagesImageIdVariantsVariantIdBuildsResponse404]
    """

    kwargs = _get_kwargs(
        image_id=image_id,
        variant_id=variant_id,
        limit=limit,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    image_id: str,
    variant_id: UUID,
    *,
    client: AuthenticatedClient,
    limit: int | Unset = 20,
) -> (
    GetImagesImageIdVariantsVariantIdBuildsResponse200
    | GetImagesImageIdVariantsVariantIdBuildsResponse404
    | None
):
    """List image variant builds

    Args:
        image_id (str):
        variant_id (UUID):
        limit (int | Unset):  Default: 20.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetImagesImageIdVariantsVariantIdBuildsResponse200 | GetImagesImageIdVariantsVariantIdBuildsResponse404
    """

    return (
        await asyncio_detailed(
            image_id=image_id,
            variant_id=variant_id,
            client=client,
            limit=limit,
        )
    ).parsed
