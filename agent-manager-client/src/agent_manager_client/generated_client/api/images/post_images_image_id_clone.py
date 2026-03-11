from http import HTTPStatus
from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_images_image_id_clone_body import PostImagesImageIdCloneBody
from ...models.post_images_image_id_clone_response_201 import (
    PostImagesImageIdCloneResponse201,
)
from ...models.post_images_image_id_clone_response_400 import (
    PostImagesImageIdCloneResponse400,
)
from ...types import UNSET, Response, Unset


def _get_kwargs(
    image_id: str,
    *,
    body: PostImagesImageIdCloneBody | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/images/{image_id}/clone".format(
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
) -> PostImagesImageIdCloneResponse201 | PostImagesImageIdCloneResponse400 | None:
    if response.status_code == 201:
        response_201 = PostImagesImageIdCloneResponse201.from_dict(response.json())

        return response_201

    if response.status_code == 400:
        response_400 = PostImagesImageIdCloneResponse400.from_dict(response.json())

        return response_400

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[PostImagesImageIdCloneResponse201 | PostImagesImageIdCloneResponse400]:
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
    body: PostImagesImageIdCloneBody | Unset = UNSET,
) -> Response[PostImagesImageIdCloneResponse201 | PostImagesImageIdCloneResponse400]:
    """Clone image

    Args:
        image_id (str):
        body (PostImagesImageIdCloneBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostImagesImageIdCloneResponse201 | PostImagesImageIdCloneResponse400]
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
    body: PostImagesImageIdCloneBody | Unset = UNSET,
) -> PostImagesImageIdCloneResponse201 | PostImagesImageIdCloneResponse400 | None:
    """Clone image

    Args:
        image_id (str):
        body (PostImagesImageIdCloneBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostImagesImageIdCloneResponse201 | PostImagesImageIdCloneResponse400
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
    body: PostImagesImageIdCloneBody | Unset = UNSET,
) -> Response[PostImagesImageIdCloneResponse201 | PostImagesImageIdCloneResponse400]:
    """Clone image

    Args:
        image_id (str):
        body (PostImagesImageIdCloneBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostImagesImageIdCloneResponse201 | PostImagesImageIdCloneResponse400]
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
    body: PostImagesImageIdCloneBody | Unset = UNSET,
) -> PostImagesImageIdCloneResponse201 | PostImagesImageIdCloneResponse400 | None:
    """Clone image

    Args:
        image_id (str):
        body (PostImagesImageIdCloneBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostImagesImageIdCloneResponse201 | PostImagesImageIdCloneResponse400
    """

    return (
        await asyncio_detailed(
            image_id=image_id,
            client=client,
            body=body,
        )
    ).parsed
