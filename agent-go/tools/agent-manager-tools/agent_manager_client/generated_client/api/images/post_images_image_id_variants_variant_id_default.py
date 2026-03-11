from http import HTTPStatus
from typing import Any
from urllib.parse import quote
from uuid import UUID

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_images_image_id_variants_variant_id_default_response_200 import (
    PostImagesImageIdVariantsVariantIdDefaultResponse200,
)
from ...models.post_images_image_id_variants_variant_id_default_response_400 import (
    PostImagesImageIdVariantsVariantIdDefaultResponse400,
)
from ...models.post_images_image_id_variants_variant_id_default_response_404 import (
    PostImagesImageIdVariantsVariantIdDefaultResponse404,
)
from ...types import Response


def _get_kwargs(
    image_id: str,
    variant_id: UUID,
) -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/images/{image_id}/variants/{variant_id}/default".format(
            image_id=quote(str(image_id), safe=""),
            variant_id=quote(str(variant_id), safe=""),
        ),
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    PostImagesImageIdVariantsVariantIdDefaultResponse200
    | PostImagesImageIdVariantsVariantIdDefaultResponse400
    | PostImagesImageIdVariantsVariantIdDefaultResponse404
    | None
):
    if response.status_code == 200:
        response_200 = PostImagesImageIdVariantsVariantIdDefaultResponse200.from_dict(
            response.json()
        )

        return response_200

    if response.status_code == 400:
        response_400 = PostImagesImageIdVariantsVariantIdDefaultResponse400.from_dict(
            response.json()
        )

        return response_400

    if response.status_code == 404:
        response_404 = PostImagesImageIdVariantsVariantIdDefaultResponse404.from_dict(
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
    PostImagesImageIdVariantsVariantIdDefaultResponse200
    | PostImagesImageIdVariantsVariantIdDefaultResponse400
    | PostImagesImageIdVariantsVariantIdDefaultResponse404
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
) -> Response[
    PostImagesImageIdVariantsVariantIdDefaultResponse200
    | PostImagesImageIdVariantsVariantIdDefaultResponse400
    | PostImagesImageIdVariantsVariantIdDefaultResponse404
]:
    """Set global default image variant

    Args:
        image_id (str):
        variant_id (UUID):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostImagesImageIdVariantsVariantIdDefaultResponse200 | PostImagesImageIdVariantsVariantIdDefaultResponse400 | PostImagesImageIdVariantsVariantIdDefaultResponse404]
    """

    kwargs = _get_kwargs(
        image_id=image_id,
        variant_id=variant_id,
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
) -> (
    PostImagesImageIdVariantsVariantIdDefaultResponse200
    | PostImagesImageIdVariantsVariantIdDefaultResponse400
    | PostImagesImageIdVariantsVariantIdDefaultResponse404
    | None
):
    """Set global default image variant

    Args:
        image_id (str):
        variant_id (UUID):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostImagesImageIdVariantsVariantIdDefaultResponse200 | PostImagesImageIdVariantsVariantIdDefaultResponse400 | PostImagesImageIdVariantsVariantIdDefaultResponse404
    """

    return sync_detailed(
        image_id=image_id,
        variant_id=variant_id,
        client=client,
    ).parsed


async def asyncio_detailed(
    image_id: str,
    variant_id: UUID,
    *,
    client: AuthenticatedClient,
) -> Response[
    PostImagesImageIdVariantsVariantIdDefaultResponse200
    | PostImagesImageIdVariantsVariantIdDefaultResponse400
    | PostImagesImageIdVariantsVariantIdDefaultResponse404
]:
    """Set global default image variant

    Args:
        image_id (str):
        variant_id (UUID):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostImagesImageIdVariantsVariantIdDefaultResponse200 | PostImagesImageIdVariantsVariantIdDefaultResponse400 | PostImagesImageIdVariantsVariantIdDefaultResponse404]
    """

    kwargs = _get_kwargs(
        image_id=image_id,
        variant_id=variant_id,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    image_id: str,
    variant_id: UUID,
    *,
    client: AuthenticatedClient,
) -> (
    PostImagesImageIdVariantsVariantIdDefaultResponse200
    | PostImagesImageIdVariantsVariantIdDefaultResponse400
    | PostImagesImageIdVariantsVariantIdDefaultResponse404
    | None
):
    """Set global default image variant

    Args:
        image_id (str):
        variant_id (UUID):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostImagesImageIdVariantsVariantIdDefaultResponse200 | PostImagesImageIdVariantsVariantIdDefaultResponse400 | PostImagesImageIdVariantsVariantIdDefaultResponse404
    """

    return (
        await asyncio_detailed(
            image_id=image_id,
            variant_id=variant_id,
            client=client,
        )
    ).parsed
