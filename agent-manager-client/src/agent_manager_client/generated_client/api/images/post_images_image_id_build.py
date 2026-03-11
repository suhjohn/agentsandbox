from http import HTTPStatus
from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_images_image_id_build_body import PostImagesImageIdBuildBody
from ...models.post_images_image_id_build_response_200 import (
    PostImagesImageIdBuildResponse200,
)
from ...models.post_images_image_id_build_response_400 import (
    PostImagesImageIdBuildResponse400,
)
from ...types import UNSET, Response, Unset


def _get_kwargs(
    image_id: str,
    *,
    body: PostImagesImageIdBuildBody | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/images/{image_id}/build".format(
            image_id=quote(str(image_id), safe=""),
        ),
    }

    if not isinstance(body, Unset):
        _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> PostImagesImageIdBuildResponse200 | PostImagesImageIdBuildResponse400 | None:
    if response.status_code == 200:
        response_200 = PostImagesImageIdBuildResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = PostImagesImageIdBuildResponse400.from_dict(response.json())

        return response_400

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[PostImagesImageIdBuildResponse200 | PostImagesImageIdBuildResponse400]:
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
    body: PostImagesImageIdBuildBody | Unset = UNSET,
) -> Response[PostImagesImageIdBuildResponse200 | PostImagesImageIdBuildResponse400]:
    """Run image build

    Args:
        image_id (str):
        body (PostImagesImageIdBuildBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostImagesImageIdBuildResponse200 | PostImagesImageIdBuildResponse400]
    """

    kwargs = _get_kwargs(
        image_id=image_id,
        body=body,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    image_id: str,
    *,
    client: AuthenticatedClient,
    body: PostImagesImageIdBuildBody | Unset = UNSET,
) -> PostImagesImageIdBuildResponse200 | PostImagesImageIdBuildResponse400 | None:
    """Run image build

    Args:
        image_id (str):
        body (PostImagesImageIdBuildBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostImagesImageIdBuildResponse200 | PostImagesImageIdBuildResponse400
    """

    return sync_detailed(
        image_id=image_id,
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    image_id: str,
    *,
    client: AuthenticatedClient,
    body: PostImagesImageIdBuildBody | Unset = UNSET,
) -> Response[PostImagesImageIdBuildResponse200 | PostImagesImageIdBuildResponse400]:
    """Run image build

    Args:
        image_id (str):
        body (PostImagesImageIdBuildBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostImagesImageIdBuildResponse200 | PostImagesImageIdBuildResponse400]
    """

    kwargs = _get_kwargs(
        image_id=image_id,
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    image_id: str,
    *,
    client: AuthenticatedClient,
    body: PostImagesImageIdBuildBody | Unset = UNSET,
) -> PostImagesImageIdBuildResponse200 | PostImagesImageIdBuildResponse400 | None:
    """Run image build

    Args:
        image_id (str):
        body (PostImagesImageIdBuildBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostImagesImageIdBuildResponse200 | PostImagesImageIdBuildResponse400
    """

    return (
        await asyncio_detailed(
            image_id=image_id,
            client=client,
            body=body,
        )
    ).parsed
