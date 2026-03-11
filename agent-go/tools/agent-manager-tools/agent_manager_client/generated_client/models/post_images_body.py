from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="PostImagesBody")


@_attrs_define
class PostImagesBody:
    """
    Attributes:
        name (str):
        description (str | Unset):
        active_image_id (str | Unset):
        draft_image_id (str | Unset):
    """

    name: str
    description: str | Unset = UNSET
    active_image_id: str | Unset = UNSET
    draft_image_id: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        description = self.description

        active_image_id = self.active_image_id

        draft_image_id = self.draft_image_id

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "name": name,
            }
        )
        if description is not UNSET:
            field_dict["description"] = description
        if active_image_id is not UNSET:
            field_dict["activeImageId"] = active_image_id
        if draft_image_id is not UNSET:
            field_dict["draftImageId"] = draft_image_id

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        name = d.pop("name")

        description = d.pop("description", UNSET)

        active_image_id = d.pop("activeImageId", UNSET)

        draft_image_id = d.pop("draftImageId", UNSET)

        post_images_body = cls(
            name=name,
            description=description,
            active_image_id=active_image_id,
            draft_image_id=draft_image_id,
        )

        post_images_body.additional_properties = d
        return post_images_body

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
