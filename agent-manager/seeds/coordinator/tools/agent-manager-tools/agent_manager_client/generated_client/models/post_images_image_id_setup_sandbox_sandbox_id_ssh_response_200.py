from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_images_image_id_setup_sandbox_sandbox_id_ssh_response_200_ssh_type_0 import (
        PostImagesImageIdSetupSandboxSandboxIdSshResponse200SshType0,
    )


T = TypeVar("T", bound="PostImagesImageIdSetupSandboxSandboxIdSshResponse200")


@_attrs_define
class PostImagesImageIdSetupSandboxSandboxIdSshResponse200:
    """
    Attributes:
        authorized_public_keys (list[str] | Unset):
        ssh (None | PostImagesImageIdSetupSandboxSandboxIdSshResponse200SshType0 | Unset):
    """

    authorized_public_keys: list[str] | Unset = UNSET
    ssh: None | PostImagesImageIdSetupSandboxSandboxIdSshResponse200SshType0 | Unset = (
        UNSET
    )
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.post_images_image_id_setup_sandbox_sandbox_id_ssh_response_200_ssh_type_0 import (
            PostImagesImageIdSetupSandboxSandboxIdSshResponse200SshType0,
        )

        authorized_public_keys: list[str] | Unset = UNSET
        if not isinstance(self.authorized_public_keys, Unset):
            authorized_public_keys = self.authorized_public_keys

        ssh: dict[str, Any] | None | Unset
        if isinstance(self.ssh, Unset):
            ssh = UNSET
        elif isinstance(
            self.ssh, PostImagesImageIdSetupSandboxSandboxIdSshResponse200SshType0
        ):
            ssh = self.ssh.to_dict()
        else:
            ssh = self.ssh

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if authorized_public_keys is not UNSET:
            field_dict["authorizedPublicKeys"] = authorized_public_keys
        if ssh is not UNSET:
            field_dict["ssh"] = ssh

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_images_image_id_setup_sandbox_sandbox_id_ssh_response_200_ssh_type_0 import (
            PostImagesImageIdSetupSandboxSandboxIdSshResponse200SshType0,
        )

        d = dict(src_dict)
        authorized_public_keys = cast(list[str], d.pop("authorizedPublicKeys", UNSET))

        def _parse_ssh(
            data: object,
        ) -> (
            None | PostImagesImageIdSetupSandboxSandboxIdSshResponse200SshType0 | Unset
        ):
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                ssh_type_0 = PostImagesImageIdSetupSandboxSandboxIdSshResponse200SshType0.from_dict(
                    data
                )

                return ssh_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(
                None
                | PostImagesImageIdSetupSandboxSandboxIdSshResponse200SshType0
                | Unset,
                data,
            )

        ssh = _parse_ssh(d.pop("ssh", UNSET))

        post_images_image_id_setup_sandbox_sandbox_id_ssh_response_200 = cls(
            authorized_public_keys=authorized_public_keys,
            ssh=ssh,
        )

        post_images_image_id_setup_sandbox_sandbox_id_ssh_response_200.additional_properties = d
        return post_images_image_id_setup_sandbox_sandbox_id_ssh_response_200

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
