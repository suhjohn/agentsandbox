from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_agents_groups_archived import GetAgentsGroupsArchived
from ...models.get_agents_groups_by import GetAgentsGroupsBy
from ...models.get_agents_groups_response_200 import GetAgentsGroupsResponse200
from ...models.get_agents_groups_type import GetAgentsGroupsType
from ...models.get_agents_groups_visibility import GetAgentsGroupsVisibility
from ...types import UNSET, Response, Unset


def _get_kwargs(
    *,
    by: GetAgentsGroupsBy,
    preview_n: int,
    archived: GetAgentsGroupsArchived | Unset = UNSET,
    type_: GetAgentsGroupsType | Unset = UNSET,
    visibility: GetAgentsGroupsVisibility | Unset = UNSET,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    json_by = by.value
    params["by"] = json_by

    params["previewN"] = preview_n

    json_archived: str | Unset = UNSET
    if not isinstance(archived, Unset):
        json_archived = archived.value

    params["archived"] = json_archived

    json_type_: str | Unset = UNSET
    if not isinstance(type_, Unset):
        json_type_ = type_.value

    params["type"] = json_type_

    json_visibility: str | Unset = UNSET
    if not isinstance(visibility, Unset):
        json_visibility = visibility.value

    params["visibility"] = json_visibility

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/agents/groups",
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> GetAgentsGroupsResponse200 | None:
    if response.status_code == 200:
        response_200 = GetAgentsGroupsResponse200.from_dict(response.json())

        return response_200

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[GetAgentsGroupsResponse200]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient,
    by: GetAgentsGroupsBy,
    preview_n: int,
    archived: GetAgentsGroupsArchived | Unset = UNSET,
    type_: GetAgentsGroupsType | Unset = UNSET,
    visibility: GetAgentsGroupsVisibility | Unset = UNSET,
) -> Response[GetAgentsGroupsResponse200]:
    """List agent groups

    Args:
        by (GetAgentsGroupsBy):
        preview_n (int):
        archived (GetAgentsGroupsArchived | Unset):
        type_ (GetAgentsGroupsType | Unset):
        visibility (GetAgentsGroupsVisibility | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetAgentsGroupsResponse200]
    """

    kwargs = _get_kwargs(
        by=by,
        preview_n=preview_n,
        archived=archived,
        type_=type_,
        visibility=visibility,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient,
    by: GetAgentsGroupsBy,
    preview_n: int,
    archived: GetAgentsGroupsArchived | Unset = UNSET,
    type_: GetAgentsGroupsType | Unset = UNSET,
    visibility: GetAgentsGroupsVisibility | Unset = UNSET,
) -> GetAgentsGroupsResponse200 | None:
    """List agent groups

    Args:
        by (GetAgentsGroupsBy):
        preview_n (int):
        archived (GetAgentsGroupsArchived | Unset):
        type_ (GetAgentsGroupsType | Unset):
        visibility (GetAgentsGroupsVisibility | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetAgentsGroupsResponse200
    """

    return sync_detailed(
        client=client,
        by=by,
        preview_n=preview_n,
        archived=archived,
        type_=type_,
        visibility=visibility,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    by: GetAgentsGroupsBy,
    preview_n: int,
    archived: GetAgentsGroupsArchived | Unset = UNSET,
    type_: GetAgentsGroupsType | Unset = UNSET,
    visibility: GetAgentsGroupsVisibility | Unset = UNSET,
) -> Response[GetAgentsGroupsResponse200]:
    """List agent groups

    Args:
        by (GetAgentsGroupsBy):
        preview_n (int):
        archived (GetAgentsGroupsArchived | Unset):
        type_ (GetAgentsGroupsType | Unset):
        visibility (GetAgentsGroupsVisibility | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetAgentsGroupsResponse200]
    """

    kwargs = _get_kwargs(
        by=by,
        preview_n=preview_n,
        archived=archived,
        type_=type_,
        visibility=visibility,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    by: GetAgentsGroupsBy,
    preview_n: int,
    archived: GetAgentsGroupsArchived | Unset = UNSET,
    type_: GetAgentsGroupsType | Unset = UNSET,
    visibility: GetAgentsGroupsVisibility | Unset = UNSET,
) -> GetAgentsGroupsResponse200 | None:
    """List agent groups

    Args:
        by (GetAgentsGroupsBy):
        preview_n (int):
        archived (GetAgentsGroupsArchived | Unset):
        type_ (GetAgentsGroupsType | Unset):
        visibility (GetAgentsGroupsVisibility | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetAgentsGroupsResponse200
    """

    return (
        await asyncio_detailed(
            client=client,
            by=by,
            preview_n=preview_n,
            archived=archived,
            type_=type_,
            visibility=visibility,
        )
    ).parsed
