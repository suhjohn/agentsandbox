from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar
from uuid import UUID

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="DeleteImagesImageIdSetupSandboxSandboxIdResponse200")


@_attrs_define
class DeleteImagesImageIdSetupSandboxSandboxIdResponse200:
    """
    Attributes:
        base_image_id (str):
        draft_image_id (str):
        variant_id (UUID):
    """

    base_image_id: str
    draft_image_id: str
    variant_id: UUID
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        base_image_id = self.base_image_id

        draft_image_id = self.draft_image_id

        variant_id = str(self.variant_id)

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "baseImageId": base_image_id,
                "draftImageId": draft_image_id,
                "variantId": variant_id,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        base_image_id = d.pop("baseImageId")

        draft_image_id = d.pop("draftImageId")

        variant_id = UUID(d.pop("variantId"))

        delete_images_image_id_setup_sandbox_sandbox_id_response_200 = cls(
            base_image_id=base_image_id,
            draft_image_id=draft_image_id,
            variant_id=variant_id,
        )

        delete_images_image_id_setup_sandbox_sandbox_id_response_200.additional_properties = d
        return delete_images_image_id_setup_sandbox_sandbox_id_response_200

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
