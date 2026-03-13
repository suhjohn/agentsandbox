from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_users_has_agents import GetUsersHasAgents
from ...models.get_users_response_200 import GetUsersResponse200
from ...types import UNSET, Response, Unset


def _get_kwargs(
    *,
    ids: str | Unset = UNSET,
    q: str | Unset = UNSET,
    has_agents: GetUsersHasAgents | Unset = UNSET,
    limit: int | Unset = 50,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    params["ids"] = ids

    params["q"] = q

    json_has_agents: str | Unset = UNSET
    if not isinstance(has_agents, Unset):
        json_has_agents = has_agents.value

    params["hasAgents"] = json_has_agents

    params["limit"] = limit

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/users",
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> GetUsersResponse200 | None:
    if response.status_code == 200:
        response_200 = GetUsersResponse200.from_dict(response.json())

        return response_200

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[GetUsersResponse200]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient,
    ids: str | Unset = UNSET,
    q: str | Unset = UNSET,
    has_agents: GetUsersHasAgents | Unset = UNSET,
    limit: int | Unset = 50,
) -> Response[GetUsersResponse200]:
    """List users

    Args:
        ids (str | Unset):
        q (str | Unset):
        has_agents (GetUsersHasAgents | Unset):
        limit (int | Unset):  Default: 50.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetUsersResponse200]
    """

    kwargs = _get_kwargs(
        ids=ids,
        q=q,
        has_agents=has_agents,
        limit=limit,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient,
    ids: str | Unset = UNSET,
    q: str | Unset = UNSET,
    has_agents: GetUsersHasAgents | Unset = UNSET,
    limit: int | Unset = 50,
) -> GetUsersResponse200 | None:
    """List users

    Args:
        ids (str | Unset):
        q (str | Unset):
        has_agents (GetUsersHasAgents | Unset):
        limit (int | Unset):  Default: 50.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetUsersResponse200
    """

    return sync_detailed(
        client=client,
        ids=ids,
        q=q,
        has_agents=has_agents,
        limit=limit,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    ids: str | Unset = UNSET,
    q: str | Unset = UNSET,
    has_agents: GetUsersHasAgents | Unset = UNSET,
    limit: int | Unset = 50,
) -> Response[GetUsersResponse200]:
    """List users

    Args:
        ids (str | Unset):
        q (str | Unset):
        has_agents (GetUsersHasAgents | Unset):
        limit (int | Unset):  Default: 50.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetUsersResponse200]
    """

    kwargs = _get_kwargs(
        ids=ids,
        q=q,
        has_agents=has_agents,
        limit=limit,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    ids: str | Unset = UNSET,
    q: str | Unset = UNSET,
    has_agents: GetUsersHasAgents | Unset = UNSET,
    limit: int | Unset = 50,
) -> GetUsersResponse200 | None:
    """List users

    Args:
        ids (str | Unset):
        q (str | Unset):
        has_agents (GetUsersHasAgents | Unset):
        limit (int | Unset):  Default: 50.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetUsersResponse200
    """

    return (
        await asyncio_detailed(
            client=client,
            ids=ids,
            q=q,
            has_agents=has_agents,
            limit=limit,
        )
    ).parsed
