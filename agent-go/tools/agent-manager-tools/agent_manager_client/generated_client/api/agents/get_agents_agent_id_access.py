from http import HTTPStatus
from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_agents_agent_id_access_response_200 import (
    GetAgentsAgentIdAccessResponse200,
)
from ...models.get_agents_agent_id_access_response_404 import (
    GetAgentsAgentIdAccessResponse404,
)
from ...models.get_agents_agent_id_access_response_409 import (
    GetAgentsAgentIdAccessResponse409,
)
from ...types import Response


def _get_kwargs(
    agent_id: str,
) -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/agents/{agent_id}/access".format(
            agent_id=quote(str(agent_id), safe=""),
        ),
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    GetAgentsAgentIdAccessResponse200
    | GetAgentsAgentIdAccessResponse404
    | GetAgentsAgentIdAccessResponse409
    | None
):
    if response.status_code == 200:
        response_200 = GetAgentsAgentIdAccessResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 404:
        response_404 = GetAgentsAgentIdAccessResponse404.from_dict(response.json())

        return response_404

    if response.status_code == 409:
        response_409 = GetAgentsAgentIdAccessResponse409.from_dict(response.json())

        return response_409

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    GetAgentsAgentIdAccessResponse200
    | GetAgentsAgentIdAccessResponse404
    | GetAgentsAgentIdAccessResponse409
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
    GetAgentsAgentIdAccessResponse200
    | GetAgentsAgentIdAccessResponse404
    | GetAgentsAgentIdAccessResponse409
]:
    """Get editor/browser access for an agent sandbox

    Args:
        agent_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetAgentsAgentIdAccessResponse200 | GetAgentsAgentIdAccessResponse404 | GetAgentsAgentIdAccessResponse409]
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
) -> (
    GetAgentsAgentIdAccessResponse200
    | GetAgentsAgentIdAccessResponse404
    | GetAgentsAgentIdAccessResponse409
    | None
):
    """Get editor/browser access for an agent sandbox

    Args:
        agent_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetAgentsAgentIdAccessResponse200 | GetAgentsAgentIdAccessResponse404 | GetAgentsAgentIdAccessResponse409
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
    GetAgentsAgentIdAccessResponse200
    | GetAgentsAgentIdAccessResponse404
    | GetAgentsAgentIdAccessResponse409
]:
    """Get editor/browser access for an agent sandbox

    Args:
        agent_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetAgentsAgentIdAccessResponse200 | GetAgentsAgentIdAccessResponse404 | GetAgentsAgentIdAccessResponse409]
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
) -> (
    GetAgentsAgentIdAccessResponse200
    | GetAgentsAgentIdAccessResponse404
    | GetAgentsAgentIdAccessResponse409
    | None
):
    """Get editor/browser access for an agent sandbox

    Args:
        agent_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetAgentsAgentIdAccessResponse200 | GetAgentsAgentIdAccessResponse404 | GetAgentsAgentIdAccessResponse409
    """

    return (
        await asyncio_detailed(
            agent_id=agent_id,
            client=client,
        )
    ).parsed
