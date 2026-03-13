from http import HTTPStatus
from typing import Any
from urllib.parse import quote
from uuid import UUID

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_coordinator_runs_run_id_cancel_body import (
    PostCoordinatorRunsRunIdCancelBody,
)
from ...models.post_coordinator_runs_run_id_cancel_response_200 import (
    PostCoordinatorRunsRunIdCancelResponse200,
)
from ...models.post_coordinator_runs_run_id_cancel_response_404 import (
    PostCoordinatorRunsRunIdCancelResponse404,
)
from ...types import UNSET, Response, Unset


def _get_kwargs(
    run_id: UUID,
    *,
    body: PostCoordinatorRunsRunIdCancelBody | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/coordinator/runs/{run_id}/cancel".format(
            run_id=quote(str(run_id), safe=""),
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
    PostCoordinatorRunsRunIdCancelResponse200
    | PostCoordinatorRunsRunIdCancelResponse404
    | None
):
    if response.status_code == 200:
        response_200 = PostCoordinatorRunsRunIdCancelResponse200.from_dict(
            response.json()
        )

        return response_200

    if response.status_code == 404:
        response_404 = PostCoordinatorRunsRunIdCancelResponse404.from_dict(
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
    PostCoordinatorRunsRunIdCancelResponse200
    | PostCoordinatorRunsRunIdCancelResponse404
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
    body: PostCoordinatorRunsRunIdCancelBody | Unset = UNSET,
) -> Response[
    PostCoordinatorRunsRunIdCancelResponse200
    | PostCoordinatorRunsRunIdCancelResponse404
]:
    """Cancel an existing agent run

    Args:
        run_id (UUID):
        body (PostCoordinatorRunsRunIdCancelBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostCoordinatorRunsRunIdCancelResponse200 | PostCoordinatorRunsRunIdCancelResponse404]
    """

    kwargs = _get_kwargs(
        run_id=run_id,
        body=body,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    run_id: UUID,
    *,
    client: AuthenticatedClient,
    body: PostCoordinatorRunsRunIdCancelBody | Unset = UNSET,
) -> (
    PostCoordinatorRunsRunIdCancelResponse200
    | PostCoordinatorRunsRunIdCancelResponse404
    | None
):
    """Cancel an existing agent run

    Args:
        run_id (UUID):
        body (PostCoordinatorRunsRunIdCancelBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostCoordinatorRunsRunIdCancelResponse200 | PostCoordinatorRunsRunIdCancelResponse404
    """

    return sync_detailed(
        run_id=run_id,
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    run_id: UUID,
    *,
    client: AuthenticatedClient,
    body: PostCoordinatorRunsRunIdCancelBody | Unset = UNSET,
) -> Response[
    PostCoordinatorRunsRunIdCancelResponse200
    | PostCoordinatorRunsRunIdCancelResponse404
]:
    """Cancel an existing agent run

    Args:
        run_id (UUID):
        body (PostCoordinatorRunsRunIdCancelBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostCoordinatorRunsRunIdCancelResponse200 | PostCoordinatorRunsRunIdCancelResponse404]
    """

    kwargs = _get_kwargs(
        run_id=run_id,
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    run_id: UUID,
    *,
    client: AuthenticatedClient,
    body: PostCoordinatorRunsRunIdCancelBody | Unset = UNSET,
) -> (
    PostCoordinatorRunsRunIdCancelResponse200
    | PostCoordinatorRunsRunIdCancelResponse404
    | None
):
    """Cancel an existing agent run

    Args:
        run_id (UUID):
        body (PostCoordinatorRunsRunIdCancelBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostCoordinatorRunsRunIdCancelResponse200 | PostCoordinatorRunsRunIdCancelResponse404
    """

    return (
        await asyncio_detailed(
            run_id=run_id,
            client=client,
            body=body,
        )
    ).parsed
