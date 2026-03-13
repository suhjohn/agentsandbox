from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="PutImagesImageIdEnvironmentSecretsBody")


@_attrs_define
class PutImagesImageIdEnvironmentSecretsBody:
    """
    Attributes:
        modal_secret_name (str):
    """

    modal_secret_name: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        modal_secret_name = self.modal_secret_name

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "modalSecretName": modal_secret_name,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        modal_secret_name = d.pop("modalSecretName")

        put_images_image_id_environment_secrets_body = cls(
            modal_secret_name=modal_secret_name,
        )

        put_images_image_id_environment_secrets_body.additional_properties = d
        return put_images_image_id_environment_secrets_body

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
