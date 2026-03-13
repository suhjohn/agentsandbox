from http import HTTPStatus
from typing import Any
from urllib.parse import quote
from uuid import UUID

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_coordinator_runs_run_id_stream_response_200 import (
    GetCoordinatorRunsRunIdStreamResponse200,
)
from ...models.get_coordinator_runs_run_id_stream_response_404 import (
    GetCoordinatorRunsRunIdStreamResponse404,
)
from ...types import UNSET, Response, Unset


def _get_kwargs(
    run_id: UUID,
    *,
    after: int | None | Unset = UNSET,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    json_after: int | None | Unset
    if isinstance(after, Unset):
        json_after = UNSET
    else:
        json_after = after
    params["after"] = json_after

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/coordinator/runs/{run_id}/stream".format(
            run_id=quote(str(run_id), safe=""),
        ),
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    GetCoordinatorRunsRunIdStreamResponse200
    | GetCoordinatorRunsRunIdStreamResponse404
    | None
):
    if response.status_code == 200:
        response_200 = GetCoordinatorRunsRunIdStreamResponse200.from_dict(
            response.json()
        )

        return response_200

    if response.status_code == 404:
        response_404 = GetCoordinatorRunsRunIdStreamResponse404.from_dict(
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
    GetCoordinatorRunsRunIdStreamResponse200 | GetCoordinatorRunsRunIdStreamResponse404
]:
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
    after: int | None | Unset = UNSET,
) -> Response[
    GetCoordinatorRunsRunIdStreamResponse200 | GetCoordinatorRunsRunIdStreamResponse404
]:
    """Stream events for an existing agent run

    Args:
        run_id (UUID):
        after (int | None | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetCoordinatorRunsRunIdStreamResponse200 | GetCoordinatorRunsRunIdStreamResponse404]
    """

    kwargs = _get_kwargs(
        run_id=run_id,
        after=after,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    run_id: UUID,
    *,
    client: AuthenticatedClient,
    after: int | None | Unset = UNSET,
) -> (
    GetCoordinatorRunsRunIdStreamResponse200
    | GetCoordinatorRunsRunIdStreamResponse404
    | None
):
    """Stream events for an existing agent run

    Args:
        run_id (UUID):
        after (int | None | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetCoordinatorRunsRunIdStreamResponse200 | GetCoordinatorRunsRunIdStreamResponse404
    """

    return sync_detailed(
        run_id=run_id,
        client=client,
        after=after,
    ).parsed


async def asyncio_detailed(
    run_id: UUID,
    *,
    client: AuthenticatedClient,
    after: int | None | Unset = UNSET,
) -> Response[
    GetCoordinatorRunsRunIdStreamResponse200 | GetCoordinatorRunsRunIdStreamResponse404
]:
    """Stream events for an existing agent run

    Args:
        run_id (UUID):
        after (int | None | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetCoordinatorRunsRunIdStreamResponse200 | GetCoordinatorRunsRunIdStreamResponse404]
    """

    kwargs = _get_kwargs(
        run_id=run_id,
        after=after,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    run_id: UUID,
    *,
    client: AuthenticatedClient,
    after: int | None | Unset = UNSET,
) -> (
    GetCoordinatorRunsRunIdStreamResponse200
    | GetCoordinatorRunsRunIdStreamResponse404
    | None
):
    """Stream events for an existing agent run

    Args:
        run_id (UUID):
        after (int | None | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetCoordinatorRunsRunIdStreamResponse200 | GetCoordinatorRunsRunIdStreamResponse404
    """

    return (
        await asyncio_detailed(
            run_id=run_id,
            client=client,
            after=after,
        )
    ).parsed
