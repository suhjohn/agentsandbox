from http import HTTPStatus
from typing import Any
from urllib.parse import quote
from uuid import UUID

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.patch_images_image_id_variants_variant_id_body import (
    PatchImagesImageIdVariantsVariantIdBody,
)
from ...models.patch_images_image_id_variants_variant_id_response_200 import (
    PatchImagesImageIdVariantsVariantIdResponse200,
)
from ...models.patch_images_image_id_variants_variant_id_response_400 import (
    PatchImagesImageIdVariantsVariantIdResponse400,
)
from ...models.patch_images_image_id_variants_variant_id_response_404 import (
    PatchImagesImageIdVariantsVariantIdResponse404,
)
from ...types import UNSET, Response, Unset


def _get_kwargs(
    image_id: str,
    variant_id: UUID,
    *,
    body: PatchImagesImageIdVariantsVariantIdBody | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "patch",
        "url": "/images/{image_id}/variants/{variant_id}".format(
            image_id=quote(str(image_id), safe=""),
            variant_id=quote(str(variant_id), safe=""),
        ),
    }

    if not isinstance(body, Unset):
        _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    PatchImagesImageIdVariantsVariantIdResponse200
    | PatchImagesImageIdVariantsVariantIdResponse400
    | PatchImagesImageIdVariantsVariantIdResponse404
    | None
):
    if response.status_code == 200:
        response_200 = PatchImagesImageIdVariantsVariantIdResponse200.from_dict(
            response.json()
        )

        return response_200

    if response.status_code == 400:
        response_400 = PatchImagesImageIdVariantsVariantIdResponse400.from_dict(
            response.json()
        )

        return response_400

    if response.status_code == 404:
        response_404 = PatchImagesImageIdVariantsVariantIdResponse404.from_dict(
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
    PatchImagesImageIdVariantsVariantIdResponse200
    | PatchImagesImageIdVariantsVariantIdResponse400
    | PatchImagesImageIdVariantsVariantIdResponse404
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
    body: PatchImagesImageIdVariantsVariantIdBody | Unset = UNSET,
) -> Response[
    PatchImagesImageIdVariantsVariantIdResponse200
    | PatchImagesImageIdVariantsVariantIdResponse400
    | PatchImagesImageIdVariantsVariantIdResponse404
]:
    """Update image variant

    Args:
        image_id (str):
        variant_id (UUID):
        body (PatchImagesImageIdVariantsVariantIdBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PatchImagesImageIdVariantsVariantIdResponse200 | PatchImagesImageIdVariantsVariantIdResponse400 | PatchImagesImageIdVariantsVariantIdResponse404]
    """

    kwargs = _get_kwargs(
        image_id=image_id,
        variant_id=variant_id,
        body=body,
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
    body: PatchImagesImageIdVariantsVariantIdBody | Unset = UNSET,
) -> (
    PatchImagesImageIdVariantsVariantIdResponse200
    | PatchImagesImageIdVariantsVariantIdResponse400
    | PatchImagesImageIdVariantsVariantIdResponse404
    | None
):
    """Update image variant

    Args:
        image_id (str):
        variant_id (UUID):
        body (PatchImagesImageIdVariantsVariantIdBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PatchImagesImageIdVariantsVariantIdResponse200 | PatchImagesImageIdVariantsVariantIdResponse400 | PatchImagesImageIdVariantsVariantIdResponse404
    """

    return sync_detailed(
        image_id=image_id,
        variant_id=variant_id,
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    image_id: str,
    variant_id: UUID,
    *,
    client: AuthenticatedClient,
    body: PatchImagesImageIdVariantsVariantIdBody | Unset = UNSET,
) -> Response[
    PatchImagesImageIdVariantsVariantIdResponse200
    | PatchImagesImageIdVariantsVariantIdResponse400
    | PatchImagesImageIdVariantsVariantIdResponse404
]:
    """Update image variant

    Args:
        image_id (str):
        variant_id (UUID):
        body (PatchImagesImageIdVariantsVariantIdBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PatchImagesImageIdVariantsVariantIdResponse200 | PatchImagesImageIdVariantsVariantIdResponse400 | PatchImagesImageIdVariantsVariantIdResponse404]
    """

    kwargs = _get_kwargs(
        image_id=image_id,
        variant_id=variant_id,
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    image_id: str,
    variant_id: UUID,
    *,
    client: AuthenticatedClient,
    body: PatchImagesImageIdVariantsVariantIdBody | Unset = UNSET,
) -> (
    PatchImagesImageIdVariantsVariantIdResponse200
    | PatchImagesImageIdVariantsVariantIdResponse400
    | PatchImagesImageIdVariantsVariantIdResponse404
    | None
):
    """Update image variant

    Args:
        image_id (str):
        variant_id (UUID):
        body (PatchImagesImageIdVariantsVariantIdBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PatchImagesImageIdVariantsVariantIdResponse200 | PatchImagesImageIdVariantsVariantIdResponse400 | PatchImagesImageIdVariantsVariantIdResponse404
    """

    return (
        await asyncio_detailed(
            image_id=image_id,
            variant_id=variant_id,
            client=client,
            body=body,
        )
    ).parsed
