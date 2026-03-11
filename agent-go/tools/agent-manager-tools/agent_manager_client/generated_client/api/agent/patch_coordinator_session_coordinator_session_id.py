from http import HTTPStatus
from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.patch_coordinator_session_coordinator_session_id_body import (
    PatchCoordinatorSessionCoordinatorSessionIdBody,
)
from ...models.patch_coordinator_session_coordinator_session_id_response_200 import (
    PatchCoordinatorSessionCoordinatorSessionIdResponse200,
)
from ...models.patch_coordinator_session_coordinator_session_id_response_404 import (
    PatchCoordinatorSessionCoordinatorSessionIdResponse404,
)
from ...types import UNSET, Response, Unset


def _get_kwargs(
    coordinator_session_id: str,
    *,
    body: PatchCoordinatorSessionCoordinatorSessionIdBody | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "patch",
        "url": "/coordinator/session/{coordinator_session_id}".format(
            coordinator_session_id=quote(str(coordinator_session_id), safe=""),
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
    PatchCoordinatorSessionCoordinatorSessionIdResponse200
    | PatchCoordinatorSessionCoordinatorSessionIdResponse404
    | None
):
    if response.status_code == 200:
        response_200 = PatchCoordinatorSessionCoordinatorSessionIdResponse200.from_dict(
            response.json()
        )

        return response_200

    if response.status_code == 404:
        response_404 = PatchCoordinatorSessionCoordinatorSessionIdResponse404.from_dict(
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
    PatchCoordinatorSessionCoordinatorSessionIdResponse200
    | PatchCoordinatorSessionCoordinatorSessionIdResponse404
]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    coordinator_session_id: str,
    *,
    client: AuthenticatedClient,
    body: PatchCoordinatorSessionCoordinatorSessionIdBody | Unset = UNSET,
) -> Response[
    PatchCoordinatorSessionCoordinatorSessionIdResponse200
    | PatchCoordinatorSessionCoordinatorSessionIdResponse404
]:
    """Update coordinator session title

    Args:
        coordinator_session_id (str):
        body (PatchCoordinatorSessionCoordinatorSessionIdBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PatchCoordinatorSessionCoordinatorSessionIdResponse200 | PatchCoordinatorSessionCoordinatorSessionIdResponse404]
    """

    kwargs = _get_kwargs(
        coordinator_session_id=coordinator_session_id,
        body=body,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    coordinator_session_id: str,
    *,
    client: AuthenticatedClient,
    body: PatchCoordinatorSessionCoordinatorSessionIdBody | Unset = UNSET,
) -> (
    PatchCoordinatorSessionCoordinatorSessionIdResponse200
    | PatchCoordinatorSessionCoordinatorSessionIdResponse404
    | None
):
    """Update coordinator session title

    Args:
        coordinator_session_id (str):
        body (PatchCoordinatorSessionCoordinatorSessionIdBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PatchCoordinatorSessionCoordinatorSessionIdResponse200 | PatchCoordinatorSessionCoordinatorSessionIdResponse404
    """

    return sync_detailed(
        coordinator_session_id=coordinator_session_id,
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    coordinator_session_id: str,
    *,
    client: AuthenticatedClient,
    body: PatchCoordinatorSessionCoordinatorSessionIdBody | Unset = UNSET,
) -> Response[
    PatchCoordinatorSessionCoordinatorSessionIdResponse200
    | PatchCoordinatorSessionCoordinatorSessionIdResponse404
]:
    """Update coordinator session title

    Args:
        coordinator_session_id (str):
        body (PatchCoordinatorSessionCoordinatorSessionIdBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PatchCoordinatorSessionCoordinatorSessionIdResponse200 | PatchCoordinatorSessionCoordinatorSessionIdResponse404]
    """

    kwargs = _get_kwargs(
        coordinator_session_id=coordinator_session_id,
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    coordinator_session_id: str,
    *,
    client: AuthenticatedClient,
    body: PatchCoordinatorSessionCoordinatorSessionIdBody | Unset = UNSET,
) -> (
    PatchCoordinatorSessionCoordinatorSessionIdResponse200
    | PatchCoordinatorSessionCoordinatorSessionIdResponse404
    | None
):
    """Update coordinator session title

    Args:
        coordinator_session_id (str):
        body (PatchCoordinatorSessionCoordinatorSessionIdBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PatchCoordinatorSessionCoordinatorSessionIdResponse200 | PatchCoordinatorSessionCoordinatorSessionIdResponse404
    """

    return (
        await asyncio_detailed(
            coordinator_session_id=coordinator_session_id,
            client=client,
            body=body,
        )
    ).parsed
