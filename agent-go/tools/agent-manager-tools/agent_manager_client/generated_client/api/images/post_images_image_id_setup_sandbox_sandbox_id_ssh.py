from http import HTTPStatus
from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_images_image_id_setup_sandbox_sandbox_id_ssh_body import (
    PostImagesImageIdSetupSandboxSandboxIdSshBody,
)
from ...models.post_images_image_id_setup_sandbox_sandbox_id_ssh_response_200 import (
    PostImagesImageIdSetupSandboxSandboxIdSshResponse200,
)
from ...models.post_images_image_id_setup_sandbox_sandbox_id_ssh_response_400 import (
    PostImagesImageIdSetupSandboxSandboxIdSshResponse400,
)
from ...models.post_images_image_id_setup_sandbox_sandbox_id_ssh_response_404 import (
    PostImagesImageIdSetupSandboxSandboxIdSshResponse404,
)
from ...types import UNSET, Response, Unset


def _get_kwargs(
    image_id: str,
    sandbox_id: str,
    *,
    body: PostImagesImageIdSetupSandboxSandboxIdSshBody | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/images/{image_id}/setup-sandbox/{sandbox_id}/ssh".format(
            image_id=quote(str(image_id), safe=""),
            sandbox_id=quote(str(sandbox_id), safe=""),
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
    PostImagesImageIdSetupSandboxSandboxIdSshResponse200
    | PostImagesImageIdSetupSandboxSandboxIdSshResponse400
    | PostImagesImageIdSetupSandboxSandboxIdSshResponse404
    | None
):
    if response.status_code == 200:
        response_200 = PostImagesImageIdSetupSandboxSandboxIdSshResponse200.from_dict(
            response.json()
        )

        return response_200

    if response.status_code == 400:
        response_400 = PostImagesImageIdSetupSandboxSandboxIdSshResponse400.from_dict(
            response.json()
        )

        return response_400

    if response.status_code == 404:
        response_404 = PostImagesImageIdSetupSandboxSandboxIdSshResponse404.from_dict(
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
    PostImagesImageIdSetupSandboxSandboxIdSshResponse200
    | PostImagesImageIdSetupSandboxSandboxIdSshResponse400
    | PostImagesImageIdSetupSandboxSandboxIdSshResponse404
]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    image_id: str,
    sandbox_id: str,
    *,
    client: AuthenticatedClient,
    body: PostImagesImageIdSetupSandboxSandboxIdSshBody | Unset = UNSET,
) -> Response[
    PostImagesImageIdSetupSandboxSandboxIdSshResponse200
    | PostImagesImageIdSetupSandboxSandboxIdSshResponse400
    | PostImagesImageIdSetupSandboxSandboxIdSshResponse404
]:
    """Add SSH public keys to setup sandbox

    Args:
        image_id (str):
        sandbox_id (str):
        body (PostImagesImageIdSetupSandboxSandboxIdSshBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostImagesImageIdSetupSandboxSandboxIdSshResponse200 | PostImagesImageIdSetupSandboxSandboxIdSshResponse400 | PostImagesImageIdSetupSandboxSandboxIdSshResponse404]
    """

    kwargs = _get_kwargs(
        image_id=image_id,
        sandbox_id=sandbox_id,
        body=body,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    image_id: str,
    sandbox_id: str,
    *,
    client: AuthenticatedClient,
    body: PostImagesImageIdSetupSandboxSandboxIdSshBody | Unset = UNSET,
) -> (
    PostImagesImageIdSetupSandboxSandboxIdSshResponse200
    | PostImagesImageIdSetupSandboxSandboxIdSshResponse400
    | PostImagesImageIdSetupSandboxSandboxIdSshResponse404
    | None
):
    """Add SSH public keys to setup sandbox

    Args:
        image_id (str):
        sandbox_id (str):
        body (PostImagesImageIdSetupSandboxSandboxIdSshBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostImagesImageIdSetupSandboxSandboxIdSshResponse200 | PostImagesImageIdSetupSandboxSandboxIdSshResponse400 | PostImagesImageIdSetupSandboxSandboxIdSshResponse404
    """

    return sync_detailed(
        image_id=image_id,
        sandbox_id=sandbox_id,
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    image_id: str,
    sandbox_id: str,
    *,
    client: AuthenticatedClient,
    body: PostImagesImageIdSetupSandboxSandboxIdSshBody | Unset = UNSET,
) -> Response[
    PostImagesImageIdSetupSandboxSandboxIdSshResponse200
    | PostImagesImageIdSetupSandboxSandboxIdSshResponse400
    | PostImagesImageIdSetupSandboxSandboxIdSshResponse404
]:
    """Add SSH public keys to setup sandbox

    Args:
        image_id (str):
        sandbox_id (str):
        body (PostImagesImageIdSetupSandboxSandboxIdSshBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostImagesImageIdSetupSandboxSandboxIdSshResponse200 | PostImagesImageIdSetupSandboxSandboxIdSshResponse400 | PostImagesImageIdSetupSandboxSandboxIdSshResponse404]
    """

    kwargs = _get_kwargs(
        image_id=image_id,
        sandbox_id=sandbox_id,
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    image_id: str,
    sandbox_id: str,
    *,
    client: AuthenticatedClient,
    body: PostImagesImageIdSetupSandboxSandboxIdSshBody | Unset = UNSET,
) -> (
    PostImagesImageIdSetupSandboxSandboxIdSshResponse200
    | PostImagesImageIdSetupSandboxSandboxIdSshResponse400
    | PostImagesImageIdSetupSandboxSandboxIdSshResponse404
    | None
):
    """Add SSH public keys to setup sandbox

    Args:
        image_id (str):
        sandbox_id (str):
        body (PostImagesImageIdSetupSandboxSandboxIdSshBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostImagesImageIdSetupSandboxSandboxIdSshResponse200 | PostImagesImageIdSetupSandboxSandboxIdSshResponse400 | PostImagesImageIdSetupSandboxSandboxIdSshResponse404
    """

    return (
        await asyncio_detailed(
            image_id=image_id,
            sandbox_id=sandbox_id,
            client=client,
            body=body,
        )
    ).parsed
