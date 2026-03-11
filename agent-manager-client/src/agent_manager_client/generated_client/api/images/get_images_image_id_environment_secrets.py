from http import HTTPStatus
from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_images_image_id_environment_secrets_response_200 import (
    GetImagesImageIdEnvironmentSecretsResponse200,
)
from ...models.get_images_image_id_environment_secrets_response_404 import (
    GetImagesImageIdEnvironmentSecretsResponse404,
)
from ...models.get_images_image_id_environment_secrets_response_500 import (
    GetImagesImageIdEnvironmentSecretsResponse500,
)
from ...types import Response


def _get_kwargs(
    image_id: str,
) -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/images/{image_id}/environment-secrets".format(
            image_id=quote(str(image_id), safe=""),
        ),
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    GetImagesImageIdEnvironmentSecretsResponse200
    | GetImagesImageIdEnvironmentSecretsResponse404
    | GetImagesImageIdEnvironmentSecretsResponse500
    | None
):
    if response.status_code == 200:
        response_200 = GetImagesImageIdEnvironmentSecretsResponse200.from_dict(
            response.json()
        )

        return response_200

    if response.status_code == 404:
        response_404 = GetImagesImageIdEnvironmentSecretsResponse404.from_dict(
            response.json()
        )

        return response_404

    if response.status_code == 500:
        response_500 = GetImagesImageIdEnvironmentSecretsResponse500.from_dict(
            response.json()
        )

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    GetImagesImageIdEnvironmentSecretsResponse200
    | GetImagesImageIdEnvironmentSecretsResponse404
    | GetImagesImageIdEnvironmentSecretsResponse500
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
    GetImagesImageIdEnvironmentSecretsResponse200
    | GetImagesImageIdEnvironmentSecretsResponse404
    | GetImagesImageIdEnvironmentSecretsResponse500
]:
    """List environment secrets

    Args:
        image_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetImagesImageIdEnvironmentSecretsResponse200 | GetImagesImageIdEnvironmentSecretsResponse404 | GetImagesImageIdEnvironmentSecretsResponse500]
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
) -> (
    GetImagesImageIdEnvironmentSecretsResponse200
    | GetImagesImageIdEnvironmentSecretsResponse404
    | GetImagesImageIdEnvironmentSecretsResponse500
    | None
):
    """List environment secrets

    Args:
        image_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetImagesImageIdEnvironmentSecretsResponse200 | GetImagesImageIdEnvironmentSecretsResponse404 | GetImagesImageIdEnvironmentSecretsResponse500
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
    GetImagesImageIdEnvironmentSecretsResponse200
    | GetImagesImageIdEnvironmentSecretsResponse404
    | GetImagesImageIdEnvironmentSecretsResponse500
]:
    """List environment secrets

    Args:
        image_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetImagesImageIdEnvironmentSecretsResponse200 | GetImagesImageIdEnvironmentSecretsResponse404 | GetImagesImageIdEnvironmentSecretsResponse500]
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
) -> (
    GetImagesImageIdEnvironmentSecretsResponse200
    | GetImagesImageIdEnvironmentSecretsResponse404
    | GetImagesImageIdEnvironmentSecretsResponse500
    | None
):
    """List environment secrets

    Args:
        image_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetImagesImageIdEnvironmentSecretsResponse200 | GetImagesImageIdEnvironmentSecretsResponse404 | GetImagesImageIdEnvironmentSecretsResponse500
    """

    return (
        await asyncio_detailed(
            image_id=image_id,
            client=client,
        )
    ).parsed
