from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="PostImagesImageIdSetupSandboxResponse200SshType0")


@_attrs_define
class PostImagesImageIdSetupSandboxResponse200SshType0:
    """
    Attributes:
        username (str):
        host (str):
        port (int):
        host_public_key (str):
        host_key_fingerprint (str):
        known_hosts_line (str):
    """

    username: str
    host: str
    port: int
    host_public_key: str
    host_key_fingerprint: str
    known_hosts_line: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        username = self.username

        host = self.host

        port = self.port

        host_public_key = self.host_public_key

        host_key_fingerprint = self.host_key_fingerprint

        known_hosts_line = self.known_hosts_line

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "username": username,
                "host": host,
                "port": port,
                "hostPublicKey": host_public_key,
                "hostKeyFingerprint": host_key_fingerprint,
                "knownHostsLine": known_hosts_line,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        username = d.pop("username")

        host = d.pop("host")

        port = d.pop("port")

        host_public_key = d.pop("hostPublicKey")

        host_key_fingerprint = d.pop("hostKeyFingerprint")

        known_hosts_line = d.pop("knownHostsLine")

        post_images_image_id_setup_sandbox_response_200_ssh_type_0 = cls(
            username=username,
            host=host,
            port=port,
            host_public_key=host_public_key,
            host_key_fingerprint=host_key_fingerprint,
            known_hosts_line=known_hosts_line,
        )

        post_images_image_id_setup_sandbox_response_200_ssh_type_0.additional_properties = d
        return post_images_image_id_setup_sandbox_response_200_ssh_type_0

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
