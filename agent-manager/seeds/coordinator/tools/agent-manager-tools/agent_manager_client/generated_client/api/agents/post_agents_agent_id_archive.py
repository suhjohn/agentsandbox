from http import HTTPStatus
from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_agents_agent_id_archive_response_200 import (
    PostAgentsAgentIdArchiveResponse200,
)
from ...models.post_agents_agent_id_archive_response_404 import (
    PostAgentsAgentIdArchiveResponse404,
)
from ...types import Response


def _get_kwargs(
    agent_id: str,
) -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/agents/{agent_id}/archive".format(
            agent_id=quote(str(agent_id), safe=""),
        ),
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> PostAgentsAgentIdArchiveResponse200 | PostAgentsAgentIdArchiveResponse404 | None:
    if response.status_code == 200:
        response_200 = PostAgentsAgentIdArchiveResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 404:
        response_404 = PostAgentsAgentIdArchiveResponse404.from_dict(response.json())

        return response_404

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PostAgentsAgentIdArchiveResponse200 | PostAgentsAgentIdArchiveResponse404
]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    agent_id: str,
    *,
    client: AuthenticatedClient,
) -> Response[
    PostAgentsAgentIdArchiveResponse200 | PostAgentsAgentIdArchiveResponse404
]:
    """Archive agent

    Args:
        agent_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostAgentsAgentIdArchiveResponse200 | PostAgentsAgentIdArchiveResponse404]
    """

    kwargs = _get_kwargs(
        agent_id=agent_id,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    agent_id: str,
    *,
    client: AuthenticatedClient,
) -> PostAgentsAgentIdArchiveResponse200 | PostAgentsAgentIdArchiveResponse404 | None:
    """Archive agent

    Args:
        agent_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostAgentsAgentIdArchiveResponse200 | PostAgentsAgentIdArchiveResponse404
    """

    return sync_detailed(
        agent_id=agent_id,
        client=client,
    ).parsed


async def asyncio_detailed(
    agent_id: str,
    *,
    client: AuthenticatedClient,
) -> Response[
    PostAgentsAgentIdArchiveResponse200 | PostAgentsAgentIdArchiveResponse404
]:
    """Archive agent

    Args:
        agent_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostAgentsAgentIdArchiveResponse200 | PostAgentsAgentIdArchiveResponse404]
    """

    kwargs = _get_kwargs(
        agent_id=agent_id,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    agent_id: str,
    *,
    client: AuthenticatedClient,
) -> PostAgentsAgentIdArchiveResponse200 | PostAgentsAgentIdArchiveResponse404 | None:
    """Archive agent

    Args:
        agent_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostAgentsAgentIdArchiveResponse200 | PostAgentsAgentIdArchiveResponse404
    """

    return (
        await asyncio_detailed(
            agent_id=agent_id,
            client=client,
        )
    ).parsed
