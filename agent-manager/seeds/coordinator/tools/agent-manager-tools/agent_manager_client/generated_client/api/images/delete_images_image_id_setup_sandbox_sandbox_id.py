from http import HTTPStatus
from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.delete_images_image_id_setup_sandbox_sandbox_id_response_200 import (
    DeleteImagesImageIdSetupSandboxSandboxIdResponse200,
)
from ...models.delete_images_image_id_setup_sandbox_sandbox_id_response_400 import (
    DeleteImagesImageIdSetupSandboxSandboxIdResponse400,
)
from ...models.delete_images_image_id_setup_sandbox_sandbox_id_response_404 import (
    DeleteImagesImageIdSetupSandboxSandboxIdResponse404,
)
from ...types import Response


def _get_kwargs(
    image_id: str,
    sandbox_id: str,
) -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "delete",
        "url": "/images/{image_id}/setup-sandbox/{sandbox_id}".format(
            image_id=quote(str(image_id), safe=""),
            sandbox_id=quote(str(sandbox_id), safe=""),
        ),
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    DeleteImagesImageIdSetupSandboxSandboxIdResponse200
    | DeleteImagesImageIdSetupSandboxSandboxIdResponse400
    | DeleteImagesImageIdSetupSandboxSandboxIdResponse404
    | None
):
    if response.status_code == 200:
        response_200 = DeleteImagesImageIdSetupSandboxSandboxIdResponse200.from_dict(
            response.json()
        )

        return response_200

    if response.status_code == 400:
        response_400 = DeleteImagesImageIdSetupSandboxSandboxIdResponse400.from_dict(
            response.json()
        )

        return response_400

    if response.status_code == 404:
        response_404 = DeleteImagesImageIdSetupSandboxSandboxIdResponse404.from_dict(
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
    DeleteImagesImageIdSetupSandboxSandboxIdResponse200
    | DeleteImagesImageIdSetupSandboxSandboxIdResponse400
    | DeleteImagesImageIdSetupSandboxSandboxIdResponse404
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
) -> Response[
    DeleteImagesImageIdSetupSandboxSandboxIdResponse200
    | DeleteImagesImageIdSetupSandboxSandboxIdResponse400
    | DeleteImagesImageIdSetupSandboxSandboxIdResponse404
]:
    """Close setup sandbox

    Args:
        image_id (str):
        sandbox_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[DeleteImagesImageIdSetupSandboxSandboxIdResponse200 | DeleteImagesImageIdSetupSandboxSandboxIdResponse400 | DeleteImagesImageIdSetupSandboxSandboxIdResponse404]
    """

    kwargs = _get_kwargs(
        image_id=image_id,
        sandbox_id=sandbox_id,
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
) -> (
    DeleteImagesImageIdSetupSandboxSandboxIdResponse200
    | DeleteImagesImageIdSetupSandboxSandboxIdResponse400
    | DeleteImagesImageIdSetupSandboxSandboxIdResponse404
    | None
):
    """Close setup sandbox

    Args:
        image_id (str):
        sandbox_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        DeleteImagesImageIdSetupSandboxSandboxIdResponse200 | DeleteImagesImageIdSetupSandboxSandboxIdResponse400 | DeleteImagesImageIdSetupSandboxSandboxIdResponse404
    """

    return sync_detailed(
        image_id=image_id,
        sandbox_id=sandbox_id,
        client=client,
    ).parsed


async def asyncio_detailed(
    image_id: str,
    sandbox_id: str,
    *,
    client: AuthenticatedClient,
) -> Response[
    DeleteImagesImageIdSetupSandboxSandboxIdResponse200
    | DeleteImagesImageIdSetupSandboxSandboxIdResponse400
    | DeleteImagesImageIdSetupSandboxSandboxIdResponse404
]:
    """Close setup sandbox

    Args:
        image_id (str):
        sandbox_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[DeleteImagesImageIdSetupSandboxSandboxIdResponse200 | DeleteImagesImageIdSetupSandboxSandboxIdResponse400 | DeleteImagesImageIdSetupSandboxSandboxIdResponse404]
    """

    kwargs = _get_kwargs(
        image_id=image_id,
        sandbox_id=sandbox_id,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    image_id: str,
    sandbox_id: str,
    *,
    client: AuthenticatedClient,
) -> (
    DeleteImagesImageIdSetupSandboxSandboxIdResponse200
    | DeleteImagesImageIdSetupSandboxSandboxIdResponse400
    | DeleteImagesImageIdSetupSandboxSandboxIdResponse404
    | None
):
    """Close setup sandbox

    Args:
        image_id (str):
        sandbox_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        DeleteImagesImageIdSetupSandboxSandboxIdResponse200 | DeleteImagesImageIdSetupSandboxSandboxIdResponse400 | DeleteImagesImageIdSetupSandboxSandboxIdResponse404
    """

    return (
        await asyncio_detailed(
            image_id=image_id,
            sandbox_id=sandbox_id,
            client=client,
        )
    ).parsed
