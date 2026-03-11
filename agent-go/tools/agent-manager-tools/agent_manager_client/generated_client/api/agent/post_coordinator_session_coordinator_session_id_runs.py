from http import HTTPStatus
from typing import Any
from urllib.parse import quote
from uuid import UUID

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_coordinator_session_coordinator_session_id_runs_body import (
    PostCoordinatorSessionCoordinatorSessionIdRunsBody,
)
from ...models.post_coordinator_session_coordinator_session_id_runs_response_200 import (
    PostCoordinatorSessionCoordinatorSessionIdRunsResponse200,
)
from ...models.post_coordinator_session_coordinator_session_id_runs_response_404 import (
    PostCoordinatorSessionCoordinatorSessionIdRunsResponse404,
)
from ...types import UNSET, Response, Unset


def _get_kwargs(
    coordinator_session_id: UUID,
    *,
    body: PostCoordinatorSessionCoordinatorSessionIdRunsBody | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/coordinator/session/{coordinator_session_id}/runs".format(
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
    PostCoordinatorSessionCoordinatorSessionIdRunsResponse200
    | PostCoordinatorSessionCoordinatorSessionIdRunsResponse404
    | None
):
    if response.status_code == 200:
        response_200 = (
            PostCoordinatorSessionCoordinatorSessionIdRunsResponse200.from_dict(
                response.json()
            )
        )

        return response_200

    if response.status_code == 404:
        response_404 = (
            PostCoordinatorSessionCoordinatorSessionIdRunsResponse404.from_dict(
                response.json()
            )
        )

        return response_404

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PostCoordinatorSessionCoordinatorSessionIdRunsResponse200
    | PostCoordinatorSessionCoordinatorSessionIdRunsResponse404
]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    coordinator_session_id: UUID,
    *,
    client: AuthenticatedClient,
    body: PostCoordinatorSessionCoordinatorSessionIdRunsBody | Unset = UNSET,
) -> Response[
    PostCoordinatorSessionCoordinatorSessionIdRunsResponse200
    | PostCoordinatorSessionCoordinatorSessionIdRunsResponse404
]:
    """Start a coordinator run for an existing session

    Args:
        coordinator_session_id (UUID):
        body (PostCoordinatorSessionCoordinatorSessionIdRunsBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostCoordinatorSessionCoordinatorSessionIdRunsResponse200 | PostCoordinatorSessionCoordinatorSessionIdRunsResponse404]
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
    coordinator_session_id: UUID,
    *,
    client: AuthenticatedClient,
    body: PostCoordinatorSessionCoordinatorSessionIdRunsBody | Unset = UNSET,
) -> (
    PostCoordinatorSessionCoordinatorSessionIdRunsResponse200
    | PostCoordinatorSessionCoordinatorSessionIdRunsResponse404
    | None
):
    """Start a coordinator run for an existing session

    Args:
        coordinator_session_id (UUID):
        body (PostCoordinatorSessionCoordinatorSessionIdRunsBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostCoordinatorSessionCoordinatorSessionIdRunsResponse200 | PostCoordinatorSessionCoordinatorSessionIdRunsResponse404
    """

    return sync_detailed(
        coordinator_session_id=coordinator_session_id,
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    coordinator_session_id: UUID,
    *,
    client: AuthenticatedClient,
    body: PostCoordinatorSessionCoordinatorSessionIdRunsBody | Unset = UNSET,
) -> Response[
    PostCoordinatorSessionCoordinatorSessionIdRunsResponse200
    | PostCoordinatorSessionCoordinatorSessionIdRunsResponse404
]:
    """Start a coordinator run for an existing session

    Args:
        coordinator_session_id (UUID):
        body (PostCoordinatorSessionCoordinatorSessionIdRunsBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostCoordinatorSessionCoordinatorSessionIdRunsResponse200 | PostCoordinatorSessionCoordinatorSessionIdRunsResponse404]
    """

    kwargs = _get_kwargs(
        coordinator_session_id=coordinator_session_id,
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    coordinator_session_id: UUID,
    *,
    client: AuthenticatedClient,
    body: PostCoordinatorSessionCoordinatorSessionIdRunsBody | Unset = UNSET,
) -> (
    PostCoordinatorSessionCoordinatorSessionIdRunsResponse200
    | PostCoordinatorSessionCoordinatorSessionIdRunsResponse404
    | None
):
    """Start a coordinator run for an existing session

    Args:
        coordinator_session_id (UUID):
        body (PostCoordinatorSessionCoordinatorSessionIdRunsBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostCoordinatorSessionCoordinatorSessionIdRunsResponse200 | PostCoordinatorSessionCoordinatorSessionIdRunsResponse404
    """

    return (
        await asyncio_detailed(
            coordinator_session_id=coordinator_session_id,
            client=client,
            body=body,
        )
    ).parsed
