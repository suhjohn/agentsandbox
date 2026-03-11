from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar
from uuid import UUID

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.post_terminal_connect_body_type_1_target_type import (
    PostTerminalConnectBodyType1TargetType,
)

T = TypeVar("T", bound="PostTerminalConnectBodyType1")


@_attrs_define
class PostTerminalConnectBodyType1:
    """
    Attributes:
        target_type (PostTerminalConnectBodyType1TargetType):
        target_id (UUID):
    """

    target_type: PostTerminalConnectBodyType1TargetType
    target_id: UUID
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        target_type = self.target_type.value

        target_id = str(self.target_id)

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "targetType": target_type,
                "targetId": target_id,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        target_type = PostTerminalConnectBodyType1TargetType(d.pop("targetType"))

        target_id = UUID(d.pop("targetId"))

        post_terminal_connect_body_type_1 = cls(
            target_type=target_type,
            target_id=target_id,
        )

        post_terminal_connect_body_type_1.additional_properties = d
        return post_terminal_connect_body_type_1

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
