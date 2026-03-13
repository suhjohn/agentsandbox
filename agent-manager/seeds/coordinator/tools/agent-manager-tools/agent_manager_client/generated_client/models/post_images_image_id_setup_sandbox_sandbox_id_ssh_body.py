from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="PostImagesImageIdSetupSandboxSandboxIdSshBody")


@_attrs_define
class PostImagesImageIdSetupSandboxSandboxIdSshBody:
    """
    Attributes:
        ssh_public_keys (list[str]):
    """

    ssh_public_keys: list[str]
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        ssh_public_keys = self.ssh_public_keys

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "sshPublicKeys": ssh_public_keys,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        ssh_public_keys = cast(list[str], d.pop("sshPublicKeys"))

        post_images_image_id_setup_sandbox_sandbox_id_ssh_body = cls(
            ssh_public_keys=ssh_public_keys,
        )

        post_images_image_id_setup_sandbox_sandbox_id_ssh_body.additional_properties = d
        return post_images_image_id_setup_sandbox_sandbox_id_ssh_body

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
