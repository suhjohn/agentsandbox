from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.post_images_image_id_variants_body_scope import (
    PostImagesImageIdVariantsBodyScope,
)
from ..types import UNSET, Unset

T = TypeVar("T", bound="PostImagesImageIdVariantsBody")


@_attrs_define
class PostImagesImageIdVariantsBody:
    """
    Attributes:
        name (str | Unset):
        scope (PostImagesImageIdVariantsBodyScope | Unset):  Default: PostImagesImageIdVariantsBodyScope.PERSONAL.
        active_image_id (str | Unset):
        draft_image_id (str | Unset):
        set_as_default (bool | Unset):  Default: False.
    """

    name: str | Unset = UNSET
    scope: PostImagesImageIdVariantsBodyScope | Unset = (
        PostImagesImageIdVariantsBodyScope.PERSONAL
    )
    active_image_id: str | Unset = UNSET
    draft_image_id: str | Unset = UNSET
    set_as_default: bool | Unset = False
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        scope: str | Unset = UNSET
        if not isinstance(self.scope, Unset):
            scope = self.scope.value

        active_image_id = self.active_image_id

        draft_image_id = self.draft_image_id

        set_as_default = self.set_as_default

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if name is not UNSET:
            field_dict["name"] = name
        if scope is not UNSET:
            field_dict["scope"] = scope
        if active_image_id is not UNSET:
            field_dict["activeImageId"] = active_image_id
        if draft_image_id is not UNSET:
            field_dict["draftImageId"] = draft_image_id
        if set_as_default is not UNSET:
            field_dict["setAsDefault"] = set_as_default

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        name = d.pop("name", UNSET)

        _scope = d.pop("scope", UNSET)
        scope: PostImagesImageIdVariantsBodyScope | Unset
        if isinstance(_scope, Unset):
            scope = UNSET
        else:
            scope = PostImagesImageIdVariantsBodyScope(_scope)

        active_image_id = d.pop("activeImageId", UNSET)

        draft_image_id = d.pop("draftImageId", UNSET)

        set_as_default = d.pop("setAsDefault", UNSET)

        post_images_image_id_variants_body = cls(
            name=name,
            scope=scope,
            active_image_id=active_image_id,
            draft_image_id=draft_image_id,
            set_as_default=set_as_default,
        )

        post_images_image_id_variants_body.additional_properties = d
        return post_images_image_id_variants_body

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
