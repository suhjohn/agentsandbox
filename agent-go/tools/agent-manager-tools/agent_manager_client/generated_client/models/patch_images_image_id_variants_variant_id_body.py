from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.patch_images_image_id_variants_variant_id_body_scope import (
    PatchImagesImageIdVariantsVariantIdBodyScope,
)
from ..types import UNSET, Unset

T = TypeVar("T", bound="PatchImagesImageIdVariantsVariantIdBody")


@_attrs_define
class PatchImagesImageIdVariantsVariantIdBody:
    """
    Attributes:
        name (str | Unset):
        active_image_id (str | Unset):
        draft_image_id (str | Unset):
        scope (PatchImagesImageIdVariantsVariantIdBodyScope | Unset):
    """

    name: str | Unset = UNSET
    active_image_id: str | Unset = UNSET
    draft_image_id: str | Unset = UNSET
    scope: PatchImagesImageIdVariantsVariantIdBodyScope | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        active_image_id = self.active_image_id

        draft_image_id = self.draft_image_id

        scope: str | Unset = UNSET
        if not isinstance(self.scope, Unset):
            scope = self.scope.value

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if name is not UNSET:
            field_dict["name"] = name
        if active_image_id is not UNSET:
            field_dict["activeImageId"] = active_image_id
        if draft_image_id is not UNSET:
            field_dict["draftImageId"] = draft_image_id
        if scope is not UNSET:
            field_dict["scope"] = scope

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        name = d.pop("name", UNSET)

        active_image_id = d.pop("activeImageId", UNSET)

        draft_image_id = d.pop("draftImageId", UNSET)

        _scope = d.pop("scope", UNSET)
        scope: PatchImagesImageIdVariantsVariantIdBodyScope | Unset
        if isinstance(_scope, Unset):
            scope = UNSET
        else:
            scope = PatchImagesImageIdVariantsVariantIdBodyScope(_scope)

        patch_images_image_id_variants_variant_id_body = cls(
            name=name,
            active_image_id=active_image_id,
            draft_image_id=draft_image_id,
            scope=scope,
        )

        patch_images_image_id_variants_variant_id_body.additional_properties = d
        return patch_images_image_id_variants_variant_id_body

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
