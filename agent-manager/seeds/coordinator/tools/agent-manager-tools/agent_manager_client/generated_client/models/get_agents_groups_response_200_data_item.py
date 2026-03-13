from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.get_agents_groups_response_200_data_item_preview_item import (
        GetAgentsGroupsResponse200DataItemPreviewItem,
    )


T = TypeVar("T", bound="GetAgentsGroupsResponse200DataItem")


@_attrs_define
class GetAgentsGroupsResponse200DataItem:
    """
    Attributes:
        key (None | str):
        label (str):
        latest_updated_at (str):
        preview (list[GetAgentsGroupsResponse200DataItemPreviewItem]):
        next_cursor (None | str):
    """

    key: None | str
    label: str
    latest_updated_at: str
    preview: list[GetAgentsGroupsResponse200DataItemPreviewItem]
    next_cursor: None | str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        key: None | str
        key = self.key

        label = self.label

        latest_updated_at = self.latest_updated_at

        preview = []
        for preview_item_data in self.preview:
            preview_item = preview_item_data.to_dict()
            preview.append(preview_item)

        next_cursor: None | str
        next_cursor = self.next_cursor

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "key": key,
                "label": label,
                "latestUpdatedAt": latest_updated_at,
                "preview": preview,
                "nextCursor": next_cursor,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_agents_groups_response_200_data_item_preview_item import (
            GetAgentsGroupsResponse200DataItemPreviewItem,
        )

        d = dict(src_dict)

        def _parse_key(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        key = _parse_key(d.pop("key"))

        label = d.pop("label")

        latest_updated_at = d.pop("latestUpdatedAt")

        preview = []
        _preview = d.pop("preview")
        for preview_item_data in _preview:
            preview_item = GetAgentsGroupsResponse200DataItemPreviewItem.from_dict(
                preview_item_data
            )

            preview.append(preview_item)

        def _parse_next_cursor(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        next_cursor = _parse_next_cursor(d.pop("nextCursor"))

        get_agents_groups_response_200_data_item = cls(
            key=key,
            label=label,
            latest_updated_at=latest_updated_at,
            preview=preview,
            next_cursor=next_cursor,
        )

        get_agents_groups_response_200_data_item.additional_properties = d
        return get_agents_groups_response_200_data_item

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
