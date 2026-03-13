from http import HTTPStatus
from typing import Any
from urllib.parse import quote
from uuid import UUID

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.delete_images_image_id_variants_variant_id_response_200 import (
    DeleteImagesImageIdVariantsVariantIdResponse200,
)
from ...models.delete_images_image_id_variants_variant_id_response_400 import (
    DeleteImagesImageIdVariantsVariantIdResponse400,
)
from ...models.delete_images_image_id_variants_variant_id_response_403 import (
    DeleteImagesImageIdVariantsVariantIdResponse403,
)
from ...models.delete_images_image_id_variants_variant_id_response_404 import (
    DeleteImagesImageIdVariantsVariantIdResponse404,
)
from ...types import Response


def _get_kwargs(
    image_id: str,
    variant_id: UUID,
) -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "delete",
        "url": "/images/{image_id}/variants/{variant_id}".format(
            image_id=quote(str(image_id), safe=""),
            variant_id=quote(str(variant_id), safe=""),
        ),
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    DeleteImagesImageIdVariantsVariantIdResponse200
    | DeleteImagesImageIdVariantsVariantIdResponse400
    | DeleteImagesImageIdVariantsVariantIdResponse403
    | DeleteImagesImageIdVariantsVariantIdResponse404
    | None
):
    if response.status_code == 200:
        response_200 = DeleteImagesImageIdVariantsVariantIdResponse200.from_dict(
            response.json()
        )

        return response_200

    if response.status_code == 400:
        response_400 = DeleteImagesImageIdVariantsVariantIdResponse400.from_dict(
            response.json()
        )

        return response_400

    if response.status_code == 403:
        response_403 = DeleteImagesImageIdVariantsVariantIdResponse403.from_dict(
            response.json()
        )

        return response_403

    if response.status_code == 404:
        response_404 = DeleteImagesImageIdVariantsVariantIdResponse404.from_dict(
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
    DeleteImagesImageIdVariantsVariantIdResponse200
    | DeleteImagesImageIdVariantsVariantIdResponse400
    | DeleteImagesImageIdVariantsVariantIdResponse403
    | DeleteImagesImageIdVariantsVariantIdResponse404
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
    DeleteImagesImageIdVariantsVariantIdResponse200
    | DeleteImagesImageIdVariantsVariantIdResponse400
    | DeleteImagesImageIdVariantsVariantIdResponse403
    | DeleteImagesImageIdVariantsVariantIdResponse404
]:
    """Delete image variant

    Args:
        image_id (str):
        variant_id (UUID):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[DeleteImagesImageIdVariantsVariantIdResponse200 | DeleteImagesImageIdVariantsVariantIdResponse400 | DeleteImagesImageIdVariantsVariantIdResponse403 | DeleteImagesImageIdVariantsVariantIdResponse404]
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
    DeleteImagesImageIdVariantsVariantIdResponse200
    | DeleteImagesImageIdVariantsVariantIdResponse400
    | DeleteImagesImageIdVariantsVariantIdResponse403
    | DeleteImagesImageIdVariantsVariantIdResponse404
    | None
):
    """Delete image variant

    Args:
        image_id (str):
        variant_id (UUID):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        DeleteImagesImageIdVariantsVariantIdResponse200 | DeleteImagesImageIdVariantsVariantIdResponse400 | DeleteImagesImageIdVariantsVariantIdResponse403 | DeleteImagesImageIdVariantsVariantIdResponse404
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
    DeleteImagesImageIdVariantsVariantIdResponse200
    | DeleteImagesImageIdVariantsVariantIdResponse400
    | DeleteImagesImageIdVariantsVariantIdResponse403
    | DeleteImagesImageIdVariantsVariantIdResponse404
]:
    """Delete image variant

    Args:
        image_id (str):
        variant_id (UUID):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[DeleteImagesImageIdVariantsVariantIdResponse200 | DeleteImagesImageIdVariantsVariantIdResponse400 | DeleteImagesImageIdVariantsVariantIdResponse403 | DeleteImagesImageIdVariantsVariantIdResponse404]
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
    DeleteImagesImageIdVariantsVariantIdResponse200
    | DeleteImagesImageIdVariantsVariantIdResponse400
    | DeleteImagesImageIdVariantsVariantIdResponse403
    | DeleteImagesImageIdVariantsVariantIdResponse404
    | None
):
    """Delete image variant

    Args:
        image_id (str):
        variant_id (UUID):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        DeleteImagesImageIdVariantsVariantIdResponse200 | DeleteImagesImageIdVariantsVariantIdResponse400 | DeleteImagesImageIdVariantsVariantIdResponse403 | DeleteImagesImageIdVariantsVariantIdResponse404
    """

    return (
        await asyncio_detailed(
            image_id=image_id,
            variant_id=variant_id,
            client=client,
        )
    ).parsed
