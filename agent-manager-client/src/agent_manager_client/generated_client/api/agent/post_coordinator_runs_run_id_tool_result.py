from http import HTTPStatus
from typing import Any
from urllib.parse import quote
from uuid import UUID

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_coordinator_runs_run_id_tool_result_body import (
    PostCoordinatorRunsRunIdToolResultBody,
)
from ...models.post_coordinator_runs_run_id_tool_result_response_200 import (
    PostCoordinatorRunsRunIdToolResultResponse200,
)
from ...models.post_coordinator_runs_run_id_tool_result_response_404 import (
    PostCoordinatorRunsRunIdToolResultResponse404,
)
from ...models.post_coordinator_runs_run_id_tool_result_response_409 import (
    PostCoordinatorRunsRunIdToolResultResponse409,
)
from ...types import UNSET, Response, Unset


def _get_kwargs(
    run_id: UUID,
    *,
    body: PostCoordinatorRunsRunIdToolResultBody | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/coordinator/runs/{run_id}/tool-result".format(
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
    PostCoordinatorRunsRunIdToolResultResponse200
    | PostCoordinatorRunsRunIdToolResultResponse404
    | PostCoordinatorRunsRunIdToolResultResponse409
    | None
):
    if response.status_code == 200:
        response_200 = PostCoordinatorRunsRunIdToolResultResponse200.from_dict(
            response.json()
        )

        return response_200

    if response.status_code == 404:
        response_404 = PostCoordinatorRunsRunIdToolResultResponse404.from_dict(
            response.json()
        )

        return response_404

    if response.status_code == 409:
        response_409 = PostCoordinatorRunsRunIdToolResultResponse409.from_dict(
            response.json()
        )

        return response_409

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PostCoordinatorRunsRunIdToolResultResponse200
    | PostCoordinatorRunsRunIdToolResultResponse404
    | PostCoordinatorRunsRunIdToolResultResponse409
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
    body: PostCoordinatorRunsRunIdToolResultBody | Unset = UNSET,
) -> Response[
    PostCoordinatorRunsRunIdToolResultResponse200
    | PostCoordinatorRunsRunIdToolResultResponse404
    | PostCoordinatorRunsRunIdToolResultResponse409
]:
    """Submit a client tool result for a pending run tool call

    Args:
        run_id (UUID):
        body (PostCoordinatorRunsRunIdToolResultBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostCoordinatorRunsRunIdToolResultResponse200 | PostCoordinatorRunsRunIdToolResultResponse404 | PostCoordinatorRunsRunIdToolResultResponse409]
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
    body: PostCoordinatorRunsRunIdToolResultBody | Unset = UNSET,
) -> (
    PostCoordinatorRunsRunIdToolResultResponse200
    | PostCoordinatorRunsRunIdToolResultResponse404
    | PostCoordinatorRunsRunIdToolResultResponse409
    | None
):
    """Submit a client tool result for a pending run tool call

    Args:
        run_id (UUID):
        body (PostCoordinatorRunsRunIdToolResultBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostCoordinatorRunsRunIdToolResultResponse200 | PostCoordinatorRunsRunIdToolResultResponse404 | PostCoordinatorRunsRunIdToolResultResponse409
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
    body: PostCoordinatorRunsRunIdToolResultBody | Unset = UNSET,
) -> Response[
    PostCoordinatorRunsRunIdToolResultResponse200
    | PostCoordinatorRunsRunIdToolResultResponse404
    | PostCoordinatorRunsRunIdToolResultResponse409
]:
    """Submit a client tool result for a pending run tool call

    Args:
        run_id (UUID):
        body (PostCoordinatorRunsRunIdToolResultBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostCoordinatorRunsRunIdToolResultResponse200 | PostCoordinatorRunsRunIdToolResultResponse404 | PostCoordinatorRunsRunIdToolResultResponse409]
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
    body: PostCoordinatorRunsRunIdToolResultBody | Unset = UNSET,
) -> (
    PostCoordinatorRunsRunIdToolResultResponse200
    | PostCoordinatorRunsRunIdToolResultResponse404
    | PostCoordinatorRunsRunIdToolResultResponse409
    | None
):
    """Submit a client tool result for a pending run tool call

    Args:
        run_id (UUID):
        body (PostCoordinatorRunsRunIdToolResultBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostCoordinatorRunsRunIdToolResultResponse200 | PostCoordinatorRunsRunIdToolResultResponse404 | PostCoordinatorRunsRunIdToolResultResponse409
    """

    return (
        await asyncio_detailed(
            run_id=run_id,
            client=client,
            body=body,
        )
    ).parsed
