from http import HTTPStatus
from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_agents_agent_id_session_body import PostAgentsAgentIdSessionBody
from ...models.post_agents_agent_id_session_response_200 import (
    PostAgentsAgentIdSessionResponse200,
)
from ...models.post_agents_agent_id_session_response_404 import (
    PostAgentsAgentIdSessionResponse404,
)
from ...models.post_agents_agent_id_session_response_409 import (
    PostAgentsAgentIdSessionResponse409,
)
from ...types import UNSET, Response, Unset


def _get_kwargs(
    agent_id: str,
    *,
    body: PostAgentsAgentIdSessionBody | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/agents/{agent_id}/session".format(
            agent_id=quote(str(agent_id), safe=""),
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
    PostAgentsAgentIdSessionResponse200
    | PostAgentsAgentIdSessionResponse404
    | PostAgentsAgentIdSessionResponse409
    | None
):
    if response.status_code == 200:
        response_200 = PostAgentsAgentIdSessionResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 404:
        response_404 = PostAgentsAgentIdSessionResponse404.from_dict(response.json())

        return response_404

    if response.status_code == 409:
        response_409 = PostAgentsAgentIdSessionResponse409.from_dict(response.json())

        return response_409

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PostAgentsAgentIdSessionResponse200
    | PostAgentsAgentIdSessionResponse404
    | PostAgentsAgentIdSessionResponse409
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
    body: PostAgentsAgentIdSessionBody | Unset = UNSET,
) -> Response[
    PostAgentsAgentIdSessionResponse200
    | PostAgentsAgentIdSessionResponse404
    | PostAgentsAgentIdSessionResponse409
]:
    """Create a runtime session and first run on an existing agent

    Args:
        agent_id (str):
        body (PostAgentsAgentIdSessionBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostAgentsAgentIdSessionResponse200 | PostAgentsAgentIdSessionResponse404 | PostAgentsAgentIdSessionResponse409]
    """

    kwargs = _get_kwargs(
        agent_id=agent_id,
        body=body,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    agent_id: str,
    *,
    client: AuthenticatedClient,
    body: PostAgentsAgentIdSessionBody | Unset = UNSET,
) -> (
    PostAgentsAgentIdSessionResponse200
    | PostAgentsAgentIdSessionResponse404
    | PostAgentsAgentIdSessionResponse409
    | None
):
    """Create a runtime session and first run on an existing agent

    Args:
        agent_id (str):
        body (PostAgentsAgentIdSessionBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostAgentsAgentIdSessionResponse200 | PostAgentsAgentIdSessionResponse404 | PostAgentsAgentIdSessionResponse409
    """

    return sync_detailed(
        agent_id=agent_id,
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    agent_id: str,
    *,
    client: AuthenticatedClient,
    body: PostAgentsAgentIdSessionBody | Unset = UNSET,
) -> Response[
    PostAgentsAgentIdSessionResponse200
    | PostAgentsAgentIdSessionResponse404
    | PostAgentsAgentIdSessionResponse409
]:
    """Create a runtime session and first run on an existing agent

    Args:
        agent_id (str):
        body (PostAgentsAgentIdSessionBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostAgentsAgentIdSessionResponse200 | PostAgentsAgentIdSessionResponse404 | PostAgentsAgentIdSessionResponse409]
    """

    kwargs = _get_kwargs(
        agent_id=agent_id,
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    agent_id: str,
    *,
    client: AuthenticatedClient,
    body: PostAgentsAgentIdSessionBody | Unset = UNSET,
) -> (
    PostAgentsAgentIdSessionResponse200
    | PostAgentsAgentIdSessionResponse404
    | PostAgentsAgentIdSessionResponse409
    | None
):
    """Create a runtime session and first run on an existing agent

    Args:
        agent_id (str):
        body (PostAgentsAgentIdSessionBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostAgentsAgentIdSessionResponse200 | PostAgentsAgentIdSessionResponse404 | PostAgentsAgentIdSessionResponse409
    """

    return (
        await asyncio_detailed(
            agent_id=agent_id,
            client=client,
            body=body,
        )
    ).parsed
