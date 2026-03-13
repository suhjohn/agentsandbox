from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field
from dateutil.parser import isoparse

from ..models.get_coordinator_session_coordinator_session_id_messages_response_200_data_item_role import (
    GetCoordinatorSessionCoordinatorSessionIdMessagesResponse200DataItemRole,
)
from ..types import UNSET, Unset

T = TypeVar(
    "T", bound="GetCoordinatorSessionCoordinatorSessionIdMessagesResponse200DataItem"
)


@_attrs_define
class GetCoordinatorSessionCoordinatorSessionIdMessagesResponse200DataItem:
    """
    Attributes:
        id (str):
        coordinator_session_id (str):
        role (GetCoordinatorSessionCoordinatorSessionIdMessagesResponse200DataItemRole):
        content (str):
        created_at (datetime.datetime | str):
        tool_calls (Any | Unset):
        tool_results (Any | Unset):
    """

    id: str
    coordinator_session_id: str
    role: GetCoordinatorSessionCoordinatorSessionIdMessagesResponse200DataItemRole
    content: str
    created_at: datetime.datetime | str
    tool_calls: Any | Unset = UNSET
    tool_results: Any | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        coordinator_session_id = self.coordinator_session_id

        role = self.role.value

        content = self.content

        created_at: str
        if isinstance(self.created_at, datetime.datetime):
            created_at = self.created_at.isoformat()
        else:
            created_at = self.created_at

        tool_calls = self.tool_calls

        tool_results = self.tool_results

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "coordinatorSessionId": coordinator_session_id,
                "role": role,
                "content": content,
                "createdAt": created_at,
            }
        )
        if tool_calls is not UNSET:
            field_dict["toolCalls"] = tool_calls
        if tool_results is not UNSET:
            field_dict["toolResults"] = tool_results

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        coordinator_session_id = d.pop("coordinatorSessionId")

        role = GetCoordinatorSessionCoordinatorSessionIdMessagesResponse200DataItemRole(
            d.pop("role")
        )

        content = d.pop("content")

        def _parse_created_at(data: object) -> datetime.datetime | str:
            try:
                if not isinstance(data, str):
                    raise TypeError()
                created_at_type_1 = isoparse(data)

                return created_at_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.datetime | str, data)

        created_at = _parse_created_at(d.pop("createdAt"))

        tool_calls = d.pop("toolCalls", UNSET)

        tool_results = d.pop("toolResults", UNSET)

        get_coordinator_session_coordinator_session_id_messages_response_200_data_item = cls(
            id=id,
            coordinator_session_id=coordinator_session_id,
            role=role,
            content=content,
            created_at=created_at,
            tool_calls=tool_calls,
            tool_results=tool_results,
        )

        get_coordinator_session_coordinator_session_id_messages_response_200_data_item.additional_properties = d
        return get_coordinator_session_coordinator_session_id_messages_response_200_data_item

    @property
    def additional_keys(self) -> list[str]:
        return list(self.additional_properties.keys())

    def __getitem__(self, key: str) -> Any:
        return self.additional_properties[key]

    def __setitem__(self, key: str, value: Any) -> None:
        self.additional_properties[key] = value

    def __delitem__(self, key: str) -> None:
        del self.additional_properties[key]

    def __contains__(self, key: str) -> bool:
        return key in self.additional_properties
