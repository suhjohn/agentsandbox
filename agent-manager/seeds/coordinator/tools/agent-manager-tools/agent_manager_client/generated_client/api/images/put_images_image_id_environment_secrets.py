from http import HTTPStatus
from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.put_images_image_id_environment_secrets_body import (
    PutImagesImageIdEnvironmentSecretsBody,
)
from ...models.put_images_image_id_environment_secrets_response_200 import (
    PutImagesImageIdEnvironmentSecretsResponse200,
)
from ...models.put_images_image_id_environment_secrets_response_400 import (
    PutImagesImageIdEnvironmentSecretsResponse400,
)
from ...models.put_images_image_id_environment_secrets_response_404 import (
    PutImagesImageIdEnvironmentSecretsResponse404,
)
from ...types import UNSET, Response, Unset


def _get_kwargs(
    image_id: str,
    *,
    body: PutImagesImageIdEnvironmentSecretsBody | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "put",
        "url": "/images/{image_id}/environment-secrets".format(
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
) -> (
    PutImagesImageIdEnvironmentSecretsResponse200
    | PutImagesImageIdEnvironmentSecretsResponse400
    | PutImagesImageIdEnvironmentSecretsResponse404
    | None
):
    if response.status_code == 200:
        response_200 = PutImagesImageIdEnvironmentSecretsResponse200.from_dict(
            response.json()
        )

        return response_200

    if response.status_code == 400:
        response_400 = PutImagesImageIdEnvironmentSecretsResponse400.from_dict(
            response.json()
        )

        return response_400

    if response.status_code == 404:
        response_404 = PutImagesImageIdEnvironmentSecretsResponse404.from_dict(
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
    PutImagesImageIdEnvironmentSecretsResponse200
    | PutImagesImageIdEnvironmentSecretsResponse400
    | PutImagesImageIdEnvironmentSecretsResponse404
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
    body: PutImagesImageIdEnvironmentSecretsBody | Unset = UNSET,
) -> Response[
    PutImagesImageIdEnvironmentSecretsResponse200
    | PutImagesImageIdEnvironmentSecretsResponse400
    | PutImagesImageIdEnvironmentSecretsResponse404
]:
    """Upsert environment secret

    Args:
        image_id (str):
        body (PutImagesImageIdEnvironmentSecretsBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PutImagesImageIdEnvironmentSecretsResponse200 | PutImagesImageIdEnvironmentSecretsResponse400 | PutImagesImageIdEnvironmentSecretsResponse404]
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
    body: PutImagesImageIdEnvironmentSecretsBody | Unset = UNSET,
) -> (
    PutImagesImageIdEnvironmentSecretsResponse200
    | PutImagesImageIdEnvironmentSecretsResponse400
    | PutImagesImageIdEnvironmentSecretsResponse404
    | None
):
    """Upsert environment secret

    Args:
        image_id (str):
        body (PutImagesImageIdEnvironmentSecretsBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PutImagesImageIdEnvironmentSecretsResponse200 | PutImagesImageIdEnvironmentSecretsResponse400 | PutImagesImageIdEnvironmentSecretsResponse404
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
    body: PutImagesImageIdEnvironmentSecretsBody | Unset = UNSET,
) -> Response[
    PutImagesImageIdEnvironmentSecretsResponse200
    | PutImagesImageIdEnvironmentSecretsResponse400
    | PutImagesImageIdEnvironmentSecretsResponse404
]:
    """Upsert environment secret

    Args:
        image_id (str):
        body (PutImagesImageIdEnvironmentSecretsBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PutImagesImageIdEnvironmentSecretsResponse200 | PutImagesImageIdEnvironmentSecretsResponse400 | PutImagesImageIdEnvironmentSecretsResponse404]
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
    body: PutImagesImageIdEnvironmentSecretsBody | Unset = UNSET,
) -> (
    PutImagesImageIdEnvironmentSecretsResponse200
    | PutImagesImageIdEnvironmentSecretsResponse400
    | PutImagesImageIdEnvironmentSecretsResponse404
    | None
):
    """Upsert environment secret

    Args:
        image_id (str):
        body (PutImagesImageIdEnvironmentSecretsBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PutImagesImageIdEnvironmentSecretsResponse200 | PutImagesImageIdEnvironmentSecretsResponse400 | PutImagesImageIdEnvironmentSecretsResponse404
    """

    return (
        await asyncio_detailed(
            image_id=image_id,
            client=client,
            body=body,
        )
    ).parsed
