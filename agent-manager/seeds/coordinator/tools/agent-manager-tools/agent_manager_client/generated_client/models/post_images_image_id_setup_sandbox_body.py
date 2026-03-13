from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast
from uuid import UUID

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="PostImagesImageIdSetupSandboxBody")


@_attrs_define
class PostImagesImageIdSetupSandboxBody:
    """
    Attributes:
        variant_id (UUID):
        ssh_public_keys (list[str] | Unset):
    """

    variant_id: UUID
    ssh_public_keys: list[str] | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        variant_id = str(self.variant_id)

        ssh_public_keys: list[str] | Unset = UNSET
        if not isinstance(self.ssh_public_keys, Unset):
            ssh_public_keys = self.ssh_public_keys

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "variantId": variant_id,
            }
        )
        if ssh_public_keys is not UNSET:
            field_dict["sshPublicKeys"] = ssh_public_keys

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        variant_id = UUID(d.pop("variantId"))

        ssh_public_keys = cast(list[str], d.pop("sshPublicKeys", UNSET))

        post_images_image_id_setup_sandbox_body = cls(
            variant_id=variant_id,
            ssh_public_keys=ssh_public_keys,
        )

        post_images_image_id_setup_sandbox_body.additional_properties = d
        return post_images_image_id_setup_sandbox_body

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
