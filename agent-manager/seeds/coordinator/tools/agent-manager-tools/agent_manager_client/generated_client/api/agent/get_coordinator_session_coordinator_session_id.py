from http import HTTPStatus
from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_coordinator_session_coordinator_session_id_response_200 import (
    GetCoordinatorSessionCoordinatorSessionIdResponse200,
)
from ...models.get_coordinator_session_coordinator_session_id_response_404 import (
    GetCoordinatorSessionCoordinatorSessionIdResponse404,
)
from ...types import Response


def _get_kwargs(
    coordinator_session_id: str,
) -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/coordinator/session/{coordinator_session_id}".format(
            coordinator_session_id=quote(str(coordinator_session_id), safe=""),
        ),
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    GetCoordinatorSessionCoordinatorSessionIdResponse200
    | GetCoordinatorSessionCoordinatorSessionIdResponse404
    | None
):
    if response.status_code == 200:
        response_200 = GetCoordinatorSessionCoordinatorSessionIdResponse200.from_dict(
            response.json()
        )

        return response_200

    if response.status_code == 404:
        response_404 = GetCoordinatorSessionCoordinatorSessionIdResponse404.from_dict(
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
    GetCoordinatorSessionCoordinatorSessionIdResponse200
    | GetCoordinatorSessionCoordinatorSessionIdResponse404
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
) -> Response[
    GetCoordinatorSessionCoordinatorSessionIdResponse200
    | GetCoordinatorSessionCoordinatorSessionIdResponse404
]:
    """Get a coordinator session by ID

    Args:
        coordinator_session_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetCoordinatorSessionCoordinatorSessionIdResponse200 | GetCoordinatorSessionCoordinatorSessionIdResponse404]
    """

    kwargs = _get_kwargs(
        coordinator_session_id=coordinator_session_id,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    coordinator_session_id: str,
    *,
    client: AuthenticatedClient,
) -> (
    GetCoordinatorSessionCoordinatorSessionIdResponse200
    | GetCoordinatorSessionCoordinatorSessionIdResponse404
    | None
):
    """Get a coordinator session by ID

    Args:
        coordinator_session_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetCoordinatorSessionCoordinatorSessionIdResponse200 | GetCoordinatorSessionCoordinatorSessionIdResponse404
    """

    return sync_detailed(
        coordinator_session_id=coordinator_session_id,
        client=client,
    ).parsed


async def asyncio_detailed(
    coordinator_session_id: str,
    *,
    client: AuthenticatedClient,
) -> Response[
    GetCoordinatorSessionCoordinatorSessionIdResponse200
    | GetCoordinatorSessionCoordinatorSessionIdResponse404
]:
    """Get a coordinator session by ID

    Args:
        coordinator_session_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetCoordinatorSessionCoordinatorSessionIdResponse200 | GetCoordinatorSessionCoordinatorSessionIdResponse404]
    """

    kwargs = _get_kwargs(
        coordinator_session_id=coordinator_session_id,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    coordinator_session_id: str,
    *,
    client: AuthenticatedClient,
) -> (
    GetCoordinatorSessionCoordinatorSessionIdResponse200
    | GetCoordinatorSessionCoordinatorSessionIdResponse404
    | None
):
    """Get a coordinator session by ID

    Args:
        coordinator_session_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetCoordinatorSessionCoordinatorSessionIdResponse200 | GetCoordinatorSessionCoordinatorSessionIdResponse404
    """

    return (
        await asyncio_detailed(
            coordinator_session_id=coordinator_session_id,
            client=client,
        )
    ).parsed
