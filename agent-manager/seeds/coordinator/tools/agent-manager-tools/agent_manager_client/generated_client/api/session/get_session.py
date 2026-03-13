from http import HTTPStatus
from typing import Any
from uuid import UUID

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_session_archived import GetSessionArchived
from ...models.get_session_created_at_range import GetSessionCreatedAtRange
from ...models.get_session_response_200 import GetSessionResponse200
from ...models.get_session_response_400 import GetSessionResponse400
from ...models.get_session_updated_at_range import GetSessionUpdatedAtRange
from ...types import UNSET, Response, Unset


def _get_kwargs(
    *,
    limit: int | Unset = 20,
    cursor: str | Unset = UNSET,
    agent_id: str | Unset | UUID = UNSET,
    image_id: str | Unset | UUID = UNSET,
    created_by: str | Unset = UNSET,
    status: str | Unset = UNSET,
    archived: GetSessionArchived | Unset = GetSessionArchived.FALSE,
    updated_at_range: GetSessionUpdatedAtRange | Unset = GetSessionUpdatedAtRange.ALL,
    created_at_range: GetSessionCreatedAtRange | Unset = GetSessionCreatedAtRange.ALL,
    q: str | Unset = UNSET,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    params["limit"] = limit

    params["cursor"] = cursor

    json_agent_id: str | Unset
    if isinstance(agent_id, Unset):
        json_agent_id = UNSET
    elif isinstance(agent_id, UUID):
        json_agent_id = str(agent_id)
    else:
        json_agent_id = agent_id
    params["agentId"] = json_agent_id

    json_image_id: str | Unset
    if isinstance(image_id, Unset):
        json_image_id = UNSET
    elif isinstance(image_id, UUID):
        json_image_id = str(image_id)
    else:
        json_image_id = image_id
    params["imageId"] = json_image_id

    params["createdBy"] = created_by

    params["status"] = status

    json_archived: str | Unset = UNSET
    if not isinstance(archived, Unset):
        json_archived = archived.value

    params["archived"] = json_archived

    json_updated_at_range: str | Unset = UNSET
    if not isinstance(updated_at_range, Unset):
        json_updated_at_range = updated_at_range.value

    params["updatedAtRange"] = json_updated_at_range

    json_created_at_range: str | Unset = UNSET
    if not isinstance(created_at_range, Unset):
        json_created_at_range = created_at_range.value

    params["createdAtRange"] = json_created_at_range

    params["q"] = q

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/session",
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> GetSessionResponse200 | GetSessionResponse400 | None:
    if response.status_code == 200:
        response_200 = GetSessionResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = GetSessionResponse400.from_dict(response.json())

        return response_400

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[GetSessionResponse200 | GetSessionResponse400]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient,
    limit: int | Unset = 20,
    cursor: str | Unset = UNSET,
    agent_id: str | Unset | UUID = UNSET,
    image_id: str | Unset | UUID = UNSET,
    created_by: str | Unset = UNSET,
    status: str | Unset = UNSET,
    archived: GetSessionArchived | Unset = GetSessionArchived.FALSE,
    updated_at_range: GetSessionUpdatedAtRange | Unset = GetSessionUpdatedAtRange.ALL,
    created_at_range: GetSessionCreatedAtRange | Unset = GetSessionCreatedAtRange.ALL,
    q: str | Unset = UNSET,
) -> Response[GetSessionResponse200 | GetSessionResponse400]:
    """List sessions

    Args:
        limit (int | Unset):  Default: 20.
        cursor (str | Unset):
        agent_id (str | Unset | UUID):
        image_id (str | Unset | UUID):
        created_by (str | Unset):
        status (str | Unset): Cosmetic session status for human filtering. Suggested values:
            initial, processing, blocked (agent needs human input to continue with todos), completed
            (no next todo).
        archived (GetSessionArchived | Unset):  Default: GetSessionArchived.FALSE.
        updated_at_range (GetSessionUpdatedAtRange | Unset):  Default:
            GetSessionUpdatedAtRange.ALL.
        created_at_range (GetSessionCreatedAtRange | Unset):  Default:
            GetSessionCreatedAtRange.ALL.
        q (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetSessionResponse200 | GetSessionResponse400]
    """

    kwargs = _get_kwargs(
        limit=limit,
        cursor=cursor,
        agent_id=agent_id,
        image_id=image_id,
        created_by=created_by,
        status=status,
        archived=archived,
        updated_at_range=updated_at_range,
        created_at_range=created_at_range,
        q=q,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient,
    limit: int | Unset = 20,
    cursor: str | Unset = UNSET,
    agent_id: str | Unset | UUID = UNSET,
    image_id: str | Unset | UUID = UNSET,
    created_by: str | Unset = UNSET,
    status: str | Unset = UNSET,
    archived: GetSessionArchived | Unset = GetSessionArchived.FALSE,
    updated_at_range: GetSessionUpdatedAtRange | Unset = GetSessionUpdatedAtRange.ALL,
    created_at_range: GetSessionCreatedAtRange | Unset = GetSessionCreatedAtRange.ALL,
    q: str | Unset = UNSET,
) -> GetSessionResponse200 | GetSessionResponse400 | None:
    """List sessions

    Args:
        limit (int | Unset):  Default: 20.
        cursor (str | Unset):
        agent_id (str | Unset | UUID):
        image_id (str | Unset | UUID):
        created_by (str | Unset):
        status (str | Unset): Cosmetic session status for human filtering. Suggested values:
            initial, processing, blocked (agent needs human input to continue with todos), completed
            (no next todo).
        archived (GetSessionArchived | Unset):  Default: GetSessionArchived.FALSE.
        updated_at_range (GetSessionUpdatedAtRange | Unset):  Default:
            GetSessionUpdatedAtRange.ALL.
        created_at_range (GetSessionCreatedAtRange | Unset):  Default:
            GetSessionCreatedAtRange.ALL.
        q (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetSessionResponse200 | GetSessionResponse400
    """

    return sync_detailed(
        client=client,
        limit=limit,
        cursor=cursor,
        agent_id=agent_id,
        image_id=image_id,
        created_by=created_by,
        status=status,
        archived=archived,
        updated_at_range=updated_at_range,
        created_at_range=created_at_range,
        q=q,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    limit: int | Unset = 20,
    cursor: str | Unset = UNSET,
    agent_id: str | Unset | UUID = UNSET,
    image_id: str | Unset | UUID = UNSET,
    created_by: str | Unset = UNSET,
    status: str | Unset = UNSET,
    archived: GetSessionArchived | Unset = GetSessionArchived.FALSE,
    updated_at_range: GetSessionUpdatedAtRange | Unset = GetSessionUpdatedAtRange.ALL,
    created_at_range: GetSessionCreatedAtRange | Unset = GetSessionCreatedAtRange.ALL,
    q: str | Unset = UNSET,
) -> Response[GetSessionResponse200 | GetSessionResponse400]:
    """List sessions

    Args:
        limit (int | Unset):  Default: 20.
        cursor (str | Unset):
        agent_id (str | Unset | UUID):
        image_id (str | Unset | UUID):
        created_by (str | Unset):
        status (str | Unset): Cosmetic session status for human filtering. Suggested values:
            initial, processing, blocked (agent needs human input to continue with todos), completed
            (no next todo).
        archived (GetSessionArchived | Unset):  Default: GetSessionArchived.FALSE.
        updated_at_range (GetSessionUpdatedAtRange | Unset):  Default:
            GetSessionUpdatedAtRange.ALL.
        created_at_range (GetSessionCreatedAtRange | Unset):  Default:
            GetSessionCreatedAtRange.ALL.
        q (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetSessionResponse200 | GetSessionResponse400]
    """

    kwargs = _get_kwargs(
        limit=limit,
        cursor=cursor,
        agent_id=agent_id,
        image_id=image_id,
        created_by=created_by,
        status=status,
        archived=archived,
        updated_at_range=updated_at_range,
        created_at_range=created_at_range,
        q=q,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    limit: int | Unset = 20,
    cursor: str | Unset = UNSET,
    agent_id: str | Unset | UUID = UNSET,
    image_id: str | Unset | UUID = UNSET,
    created_by: str | Unset = UNSET,
    status: str | Unset = UNSET,
    archived: GetSessionArchived | Unset = GetSessionArchived.FALSE,
    updated_at_range: GetSessionUpdatedAtRange | Unset = GetSessionUpdatedAtRange.ALL,
    created_at_range: GetSessionCreatedAtRange | Unset = GetSessionCreatedAtRange.ALL,
    q: str | Unset = UNSET,
) -> GetSessionResponse200 | GetSessionResponse400 | None:
    """List sessions

    Args:
        limit (int | Unset):  Default: 20.
        cursor (str | Unset):
        agent_id (str | Unset | UUID):
        image_id (str | Unset | UUID):
        created_by (str | Unset):
        status (str | Unset): Cosmetic session status for human filtering. Suggested values:
            initial, processing, blocked (agent needs human input to continue with todos), completed
            (no next todo).
        archived (GetSessionArchived | Unset):  Default: GetSessionArchived.FALSE.
        updated_at_range (GetSessionUpdatedAtRange | Unset):  Default:
            GetSessionUpdatedAtRange.ALL.
        created_at_range (GetSessionCreatedAtRange | Unset):  Default:
            GetSessionCreatedAtRange.ALL.
        q (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetSessionResponse200 | GetSessionResponse400
    """

    return (
        await asyncio_detailed(
            client=client,
            limit=limit,
            cursor=cursor,
            agent_id=agent_id,
            image_id=image_id,
            created_by=created_by,
            status=status,
            archived=archived,
            updated_at_range=updated_at_range,
            created_at_range=created_at_range,
            q=q,
        )
    ).parsed
