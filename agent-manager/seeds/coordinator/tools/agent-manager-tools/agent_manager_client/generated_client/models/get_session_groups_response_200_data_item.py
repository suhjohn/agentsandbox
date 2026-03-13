from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.get_session_groups_response_200_data_item_sessions_item import (
        GetSessionGroupsResponse200DataItemSessionsItem,
    )


T = TypeVar("T", bound="GetSessionGroupsResponse200DataItem")


@_attrs_define
class GetSessionGroupsResponse200DataItem:
    """
    Attributes:
        key (None | str):
        label (str):
        latest_updated_at (str):
        sessions (list[GetSessionGroupsResponse200DataItemSessionsItem]):
    """

    key: None | str
    label: str
    latest_updated_at: str
    sessions: list[GetSessionGroupsResponse200DataItemSessionsItem]
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        key: None | str
        key = self.key

        label = self.label

        latest_updated_at = self.latest_updated_at

        sessions = []
        for sessions_item_data in self.sessions:
            sessions_item = sessions_item_data.to_dict()
            sessions.append(sessions_item)

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "key": key,
                "label": label,
                "latestUpdatedAt": latest_updated_at,
                "sessions": sessions,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_session_groups_response_200_data_item_sessions_item import (
            GetSessionGroupsResponse200DataItemSessionsItem,
        )

        d = dict(src_dict)

        def _parse_key(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        key = _parse_key(d.pop("key"))

        label = d.pop("label")

        latest_updated_at = d.pop("latestUpdatedAt")

        sessions = []
        _sessions = d.pop("sessions")
        for sessions_item_data in _sessions:
            sessions_item = GetSessionGroupsResponse200DataItemSessionsItem.from_dict(
                sessions_item_data
            )

            sessions.append(sessions_item)

        get_session_groups_response_200_data_item = cls(
            key=key,
            label=label,
            latest_updated_at=latest_updated_at,
            sessions=sessions,
        )

        get_session_groups_response_200_data_item.additional_properties = d
        return get_session_groups_response_200_data_item

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
