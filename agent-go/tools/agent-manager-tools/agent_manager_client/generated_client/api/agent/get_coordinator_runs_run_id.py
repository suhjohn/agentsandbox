from http import HTTPStatus
from typing import Any
from urllib.parse import quote
from uuid import UUID

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_coordinator_runs_run_id_response_200 import (
    GetCoordinatorRunsRunIdResponse200,
)
from ...models.get_coordinator_runs_run_id_response_404 import (
    GetCoordinatorRunsRunIdResponse404,
)
from ...types import Response


def _get_kwargs(
    run_id: UUID,
) -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/coordinator/runs/{run_id}".format(
            run_id=quote(str(run_id), safe=""),
        ),
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> GetCoordinatorRunsRunIdResponse200 | GetCoordinatorRunsRunIdResponse404 | None:
    if response.status_code == 200:
        response_200 = GetCoordinatorRunsRunIdResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 404:
        response_404 = GetCoordinatorRunsRunIdResponse404.from_dict(response.json())

        return response_404

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[GetCoordinatorRunsRunIdResponse200 | GetCoordinatorRunsRunIdResponse404]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    run_id: UUID,
    *,
    client: AuthenticatedClient,
) -> Response[GetCoordinatorRunsRunIdResponse200 | GetCoordinatorRunsRunIdResponse404]:
    """Get status for an existing agent run

    Args:
        run_id (UUID):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetCoordinatorRunsRunIdResponse200 | GetCoordinatorRunsRunIdResponse404]
    """

    kwargs = _get_kwargs(
        run_id=run_id,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    run_id: UUID,
    *,
    client: AuthenticatedClient,
) -> GetCoordinatorRunsRunIdResponse200 | GetCoordinatorRunsRunIdResponse404 | None:
    """Get status for an existing agent run

    Args:
        run_id (UUID):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetCoordinatorRunsRunIdResponse200 | GetCoordinatorRunsRunIdResponse404
    """

    return sync_detailed(
        run_id=run_id,
        client=client,
    ).parsed


async def asyncio_detailed(
    run_id: UUID,
    *,
    client: AuthenticatedClient,
) -> Response[GetCoordinatorRunsRunIdResponse200 | GetCoordinatorRunsRunIdResponse404]:
    """Get status for an existing agent run

    Args:
        run_id (UUID):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetCoordinatorRunsRunIdResponse200 | GetCoordinatorRunsRunIdResponse404]
    """

    kwargs = _get_kwargs(
        run_id=run_id,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    run_id: UUID,
    *,
    client: AuthenticatedClient,
) -> GetCoordinatorRunsRunIdResponse200 | GetCoordinatorRunsRunIdResponse404 | None:
    """Get status for an existing agent run

    Args:
        run_id (UUID):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetCoordinatorRunsRunIdResponse200 | GetCoordinatorRunsRunIdResponse404
    """

    return (
        await asyncio_detailed(
            run_id=run_id,
            client=client,
        )
    ).parsed
