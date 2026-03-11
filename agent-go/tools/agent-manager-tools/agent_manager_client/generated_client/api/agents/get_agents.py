from http import HTTPStatus
from typing import Any
from uuid import UUID

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_agents_archived import GetAgentsArchived
from ...models.get_agents_no_image import GetAgentsNoImage
from ...models.get_agents_response_200 import GetAgentsResponse200
from ...models.get_agents_status import GetAgentsStatus
from ...models.get_agents_type import GetAgentsType
from ...models.get_agents_visibility import GetAgentsVisibility
from ...types import UNSET, Response, Unset


def _get_kwargs(
    *,
    status: GetAgentsStatus | Unset = UNSET,
    image_id: UUID | Unset = UNSET,
    no_image: GetAgentsNoImage | Unset = UNSET,
    archived: GetAgentsArchived | Unset = UNSET,
    created_by: UUID | Unset = UNSET,
    type_: GetAgentsType | Unset = UNSET,
    visibility: GetAgentsVisibility | Unset = UNSET,
    parent_agent_id: UUID | Unset = UNSET,
    q: str | Unset = UNSET,
    limit: int | Unset = 20,
    cursor: str | Unset = UNSET,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    json_status: str | Unset = UNSET
    if not isinstance(status, Unset):
        json_status = status.value

    params["status"] = json_status

    json_image_id: str | Unset = UNSET
    if not isinstance(image_id, Unset):
        json_image_id = str(image_id)
    params["imageId"] = json_image_id

    json_no_image: str | Unset = UNSET
    if not isinstance(no_image, Unset):
        json_no_image = no_image.value

    params["noImage"] = json_no_image

    json_archived: str | Unset = UNSET
    if not isinstance(archived, Unset):
        json_archived = archived.value

    params["archived"] = json_archived

    json_created_by: str | Unset = UNSET
    if not isinstance(created_by, Unset):
        json_created_by = str(created_by)
    params["createdBy"] = json_created_by

    json_type_: str | Unset = UNSET
    if not isinstance(type_, Unset):
        json_type_ = type_.value

    params["type"] = json_type_

    json_visibility: str | Unset = UNSET
    if not isinstance(visibility, Unset):
        json_visibility = visibility.value

    params["visibility"] = json_visibility

    json_parent_agent_id: str | Unset = UNSET
    if not isinstance(parent_agent_id, Unset):
        json_parent_agent_id = str(parent_agent_id)
    params["parentAgentId"] = json_parent_agent_id

    params["q"] = q

    params["limit"] = limit

    params["cursor"] = cursor

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/agents",
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> GetAgentsResponse200 | None:
    if response.status_code == 200:
        response_200 = GetAgentsResponse200.from_dict(response.json())

        return response_200

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[GetAgentsResponse200]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient,
    status: GetAgentsStatus | Unset = UNSET,
    image_id: UUID | Unset = UNSET,
    no_image: GetAgentsNoImage | Unset = UNSET,
    archived: GetAgentsArchived | Unset = UNSET,
    created_by: UUID | Unset = UNSET,
    type_: GetAgentsType | Unset = UNSET,
    visibility: GetAgentsVisibility | Unset = UNSET,
    parent_agent_id: UUID | Unset = UNSET,
    q: str | Unset = UNSET,
    limit: int | Unset = 20,
    cursor: str | Unset = UNSET,
) -> Response[GetAgentsResponse200]:
    """List agents

    Args:
        status (GetAgentsStatus | Unset):
        image_id (UUID | Unset):
        no_image (GetAgentsNoImage | Unset):
        archived (GetAgentsArchived | Unset):
        created_by (UUID | Unset):
        type_ (GetAgentsType | Unset):
        visibility (GetAgentsVisibility | Unset):
        parent_agent_id (UUID | Unset):
        q (str | Unset):
        limit (int | Unset):  Default: 20.
        cursor (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetAgentsResponse200]
    """

    kwargs = _get_kwargs(
        status=status,
        image_id=image_id,
        no_image=no_image,
        archived=archived,
        created_by=created_by,
        type_=type_,
        visibility=visibility,
        parent_agent_id=parent_agent_id,
        q=q,
        limit=limit,
        cursor=cursor,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient,
    status: GetAgentsStatus | Unset = UNSET,
    image_id: UUID | Unset = UNSET,
    no_image: GetAgentsNoImage | Unset = UNSET,
    archived: GetAgentsArchived | Unset = UNSET,
    created_by: UUID | Unset = UNSET,
    type_: GetAgentsType | Unset = UNSET,
    visibility: GetAgentsVisibility | Unset = UNSET,
    parent_agent_id: UUID | Unset = UNSET,
    q: str | Unset = UNSET,
    limit: int | Unset = 20,
    cursor: str | Unset = UNSET,
) -> GetAgentsResponse200 | None:
    """List agents

    Args:
        status (GetAgentsStatus | Unset):
        image_id (UUID | Unset):
        no_image (GetAgentsNoImage | Unset):
        archived (GetAgentsArchived | Unset):
        created_by (UUID | Unset):
        type_ (GetAgentsType | Unset):
        visibility (GetAgentsVisibility | Unset):
        parent_agent_id (UUID | Unset):
        q (str | Unset):
        limit (int | Unset):  Default: 20.
        cursor (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetAgentsResponse200
    """

    return sync_detailed(
        client=client,
        status=status,
        image_id=image_id,
        no_image=no_image,
        archived=archived,
        created_by=created_by,
        type_=type_,
        visibility=visibility,
        parent_agent_id=parent_agent_id,
        q=q,
        limit=limit,
        cursor=cursor,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    status: GetAgentsStatus | Unset = UNSET,
    image_id: UUID | Unset = UNSET,
    no_image: GetAgentsNoImage | Unset = UNSET,
    archived: GetAgentsArchived | Unset = UNSET,
    created_by: UUID | Unset = UNSET,
    type_: GetAgentsType | Unset = UNSET,
    visibility: GetAgentsVisibility | Unset = UNSET,
    parent_agent_id: UUID | Unset = UNSET,
    q: str | Unset = UNSET,
    limit: int | Unset = 20,
    cursor: str | Unset = UNSET,
) -> Response[GetAgentsResponse200]:
    """List agents

    Args:
        status (GetAgentsStatus | Unset):
        image_id (UUID | Unset):
        no_image (GetAgentsNoImage | Unset):
        archived (GetAgentsArchived | Unset):
        created_by (UUID | Unset):
        type_ (GetAgentsType | Unset):
        visibility (GetAgentsVisibility | Unset):
        parent_agent_id (UUID | Unset):
        q (str | Unset):
        limit (int | Unset):  Default: 20.
        cursor (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetAgentsResponse200]
    """

    kwargs = _get_kwargs(
        status=status,
        image_id=image_id,
        no_image=no_image,
        archived=archived,
        created_by=created_by,
        type_=type_,
        visibility=visibility,
        parent_agent_id=parent_agent_id,
        q=q,
        limit=limit,
        cursor=cursor,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    status: GetAgentsStatus | Unset = UNSET,
    image_id: UUID | Unset = UNSET,
    no_image: GetAgentsNoImage | Unset = UNSET,
    archived: GetAgentsArchived | Unset = UNSET,
    created_by: UUID | Unset = UNSET,
    type_: GetAgentsType | Unset = UNSET,
    visibility: GetAgentsVisibility | Unset = UNSET,
    parent_agent_id: UUID | Unset = UNSET,
    q: str | Unset = UNSET,
    limit: int | Unset = 20,
    cursor: str | Unset = UNSET,
) -> GetAgentsResponse200 | None:
    """List agents

    Args:
        status (GetAgentsStatus | Unset):
        image_id (UUID | Unset):
        no_image (GetAgentsNoImage | Unset):
        archived (GetAgentsArchived | Unset):
        created_by (UUID | Unset):
        type_ (GetAgentsType | Unset):
        visibility (GetAgentsVisibility | Unset):
        parent_agent_id (UUID | Unset):
        q (str | Unset):
        limit (int | Unset):  Default: 20.
        cursor (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetAgentsResponse200
    """

    return (
        await asyncio_detailed(
            client=client,
            status=status,
            image_id=image_id,
            no_image=no_image,
            archived=archived,
            created_by=created_by,
            type_=type_,
            visibility=visibility,
            parent_agent_id=parent_agent_id,
            q=q,
            limit=limit,
            cursor=cursor,
        )
    ).parsed
