from http import HTTPStatus
from typing import Any
from uuid import UUID

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_session_groups_archived import GetSessionGroupsArchived
from ...models.get_session_groups_by import GetSessionGroupsBy
from ...models.get_session_groups_created_at_range import GetSessionGroupsCreatedAtRange
from ...models.get_session_groups_response_200 import GetSessionGroupsResponse200
from ...models.get_session_groups_response_400 import GetSessionGroupsResponse400
from ...models.get_session_groups_updated_at_range import GetSessionGroupsUpdatedAtRange
from ...types import UNSET, Response, Unset


def _get_kwargs(
    *,
    by: GetSessionGroupsBy | Unset = GetSessionGroupsBy.IMAGEID,
    limit: int | Unset = 100,
    agent_id: str | Unset | UUID = UNSET,
    image_id: str | Unset | UUID = UNSET,
    created_by: str | Unset = UNSET,
    status: str | Unset = UNSET,
    archived: GetSessionGroupsArchived | Unset = GetSessionGroupsArchived.FALSE,
    updated_at_range: GetSessionGroupsUpdatedAtRange
    | Unset = GetSessionGroupsUpdatedAtRange.ALL,
    created_at_range: GetSessionGroupsCreatedAtRange
    | Unset = GetSessionGroupsCreatedAtRange.ALL,
    q: str | Unset = UNSET,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    json_by: str | Unset = UNSET
    if not isinstance(by, Unset):
        json_by = by.value

    params["by"] = json_by

    params["limit"] = limit

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
        "url": "/session/groups",
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> GetSessionGroupsResponse200 | GetSessionGroupsResponse400 | None:
    if response.status_code == 200:
        response_200 = GetSessionGroupsResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = GetSessionGroupsResponse400.from_dict(response.json())

        return response_400

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[GetSessionGroupsResponse200 | GetSessionGroupsResponse400]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient,
    by: GetSessionGroupsBy | Unset = GetSessionGroupsBy.IMAGEID,
    limit: int | Unset = 100,
    agent_id: str | Unset | UUID = UNSET,
    image_id: str | Unset | UUID = UNSET,
    created_by: str | Unset = UNSET,
    status: str | Unset = UNSET,
    archived: GetSessionGroupsArchived | Unset = GetSessionGroupsArchived.FALSE,
    updated_at_range: GetSessionGroupsUpdatedAtRange
    | Unset = GetSessionGroupsUpdatedAtRange.ALL,
    created_at_range: GetSessionGroupsCreatedAtRange
    | Unset = GetSessionGroupsCreatedAtRange.ALL,
    q: str | Unset = UNSET,
) -> Response[GetSessionGroupsResponse200 | GetSessionGroupsResponse400]:
    """List session groups

    Args:
        by (GetSessionGroupsBy | Unset):  Default: GetSessionGroupsBy.IMAGEID.
        limit (int | Unset):  Default: 100.
        agent_id (str | Unset | UUID):
        image_id (str | Unset | UUID):
        created_by (str | Unset):
        status (str | Unset): Cosmetic session status for human filtering. Suggested values:
            initial, processing, blocked (agent needs human input to continue with todos), completed
            (no next todo).
        archived (GetSessionGroupsArchived | Unset):  Default: GetSessionGroupsArchived.FALSE.
        updated_at_range (GetSessionGroupsUpdatedAtRange | Unset):  Default:
            GetSessionGroupsUpdatedAtRange.ALL.
        created_at_range (GetSessionGroupsCreatedAtRange | Unset):  Default:
            GetSessionGroupsCreatedAtRange.ALL.
        q (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetSessionGroupsResponse200 | GetSessionGroupsResponse400]
    """

    kwargs = _get_kwargs(
        by=by,
        limit=limit,
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
    by: GetSessionGroupsBy | Unset = GetSessionGroupsBy.IMAGEID,
    limit: int | Unset = 100,
    agent_id: str | Unset | UUID = UNSET,
    image_id: str | Unset | UUID = UNSET,
    created_by: str | Unset = UNSET,
    status: str | Unset = UNSET,
    archived: GetSessionGroupsArchived | Unset = GetSessionGroupsArchived.FALSE,
    updated_at_range: GetSessionGroupsUpdatedAtRange
    | Unset = GetSessionGroupsUpdatedAtRange.ALL,
    created_at_range: GetSessionGroupsCreatedAtRange
    | Unset = GetSessionGroupsCreatedAtRange.ALL,
    q: str | Unset = UNSET,
) -> GetSessionGroupsResponse200 | GetSessionGroupsResponse400 | None:
    """List session groups

    Args:
        by (GetSessionGroupsBy | Unset):  Default: GetSessionGroupsBy.IMAGEID.
        limit (int | Unset):  Default: 100.
        agent_id (str | Unset | UUID):
        image_id (str | Unset | UUID):
        created_by (str | Unset):
        status (str | Unset): Cosmetic session status for human filtering. Suggested values:
            initial, processing, blocked (agent needs human input to continue with todos), completed
            (no next todo).
        archived (GetSessionGroupsArchived | Unset):  Default: GetSessionGroupsArchived.FALSE.
        updated_at_range (GetSessionGroupsUpdatedAtRange | Unset):  Default:
            GetSessionGroupsUpdatedAtRange.ALL.
        created_at_range (GetSessionGroupsCreatedAtRange | Unset):  Default:
            GetSessionGroupsCreatedAtRange.ALL.
        q (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetSessionGroupsResponse200 | GetSessionGroupsResponse400
    """

    return sync_detailed(
        client=client,
        by=by,
        limit=limit,
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
    by: GetSessionGroupsBy | Unset = GetSessionGroupsBy.IMAGEID,
    limit: int | Unset = 100,
    agent_id: str | Unset | UUID = UNSET,
    image_id: str | Unset | UUID = UNSET,
    created_by: str | Unset = UNSET,
    status: str | Unset = UNSET,
    archived: GetSessionGroupsArchived | Unset = GetSessionGroupsArchived.FALSE,
    updated_at_range: GetSessionGroupsUpdatedAtRange
    | Unset = GetSessionGroupsUpdatedAtRange.ALL,
    created_at_range: GetSessionGroupsCreatedAtRange
    | Unset = GetSessionGroupsCreatedAtRange.ALL,
    q: str | Unset = UNSET,
) -> Response[GetSessionGroupsResponse200 | GetSessionGroupsResponse400]:
    """List session groups

    Args:
        by (GetSessionGroupsBy | Unset):  Default: GetSessionGroupsBy.IMAGEID.
        limit (int | Unset):  Default: 100.
        agent_id (str | Unset | UUID):
        image_id (str | Unset | UUID):
        created_by (str | Unset):
        status (str | Unset): Cosmetic session status for human filtering. Suggested values:
            initial, processing, blocked (agent needs human input to continue with todos), completed
            (no next todo).
        archived (GetSessionGroupsArchived | Unset):  Default: GetSessionGroupsArchived.FALSE.
        updated_at_range (GetSessionGroupsUpdatedAtRange | Unset):  Default:
            GetSessionGroupsUpdatedAtRange.ALL.
        created_at_range (GetSessionGroupsCreatedAtRange | Unset):  Default:
            GetSessionGroupsCreatedAtRange.ALL.
        q (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetSessionGroupsResponse200 | GetSessionGroupsResponse400]
    """

    kwargs = _get_kwargs(
        by=by,
        limit=limit,
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
    by: GetSessionGroupsBy | Unset = GetSessionGroupsBy.IMAGEID,
    limit: int | Unset = 100,
    agent_id: str | Unset | UUID = UNSET,
    image_id: str | Unset | UUID = UNSET,
    created_by: str | Unset = UNSET,
    status: str | Unset = UNSET,
    archived: GetSessionGroupsArchived | Unset = GetSessionGroupsArchived.FALSE,
    updated_at_range: GetSessionGroupsUpdatedAtRange
    | Unset = GetSessionGroupsUpdatedAtRange.ALL,
    created_at_range: GetSessionGroupsCreatedAtRange
    | Unset = GetSessionGroupsCreatedAtRange.ALL,
    q: str | Unset = UNSET,
) -> GetSessionGroupsResponse200 | GetSessionGroupsResponse400 | None:
    """List session groups

    Args:
        by (GetSessionGroupsBy | Unset):  Default: GetSessionGroupsBy.IMAGEID.
        limit (int | Unset):  Default: 100.
        agent_id (str | Unset | UUID):
        image_id (str | Unset | UUID):
        created_by (str | Unset):
        status (str | Unset): Cosmetic session status for human filtering. Suggested values:
            initial, processing, blocked (agent needs human input to continue with todos), completed
            (no next todo).
        archived (GetSessionGroupsArchived | Unset):  Default: GetSessionGroupsArchived.FALSE.
        updated_at_range (GetSessionGroupsUpdatedAtRange | Unset):  Default:
            GetSessionGroupsUpdatedAtRange.ALL.
        created_at_range (GetSessionGroupsCreatedAtRange | Unset):  Default:
            GetSessionGroupsCreatedAtRange.ALL.
        q (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetSessionGroupsResponse200 | GetSessionGroupsResponse400
    """

    return (
        await asyncio_detailed(
            client=client,
            by=by,
            limit=limit,
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
