from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field
from dateutil.parser import isoparse

T = TypeVar("T", bound="PutImagesImageIdEnvironmentSecretsResponse200")


@_attrs_define
class PutImagesImageIdEnvironmentSecretsResponse200:
    """
    Attributes:
        id (str):
        image_id (None | str):
        modal_secret_name (str):
        created_at (datetime.datetime | str):
        updated_at (datetime.datetime | str):
    """

    id: str
    image_id: None | str
    modal_secret_name: str
    created_at: datetime.datetime | str
    updated_at: datetime.datetime | str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        image_id: None | str
        image_id = self.image_id

        modal_secret_name = self.modal_secret_name

        created_at: str
        if isinstance(self.created_at, datetime.datetime):
            created_at = self.created_at.isoformat()
        else:
            created_at = self.created_at

        updated_at: str
        if isinstance(self.updated_at, datetime.datetime):
            updated_at = self.updated_at.isoformat()
        else:
            updated_at = self.updated_at

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "imageId": image_id,
                "modalSecretName": modal_secret_name,
                "createdAt": created_at,
                "updatedAt": updated_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        def _parse_image_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        image_id = _parse_image_id(d.pop("imageId"))

        modal_secret_name = d.pop("modalSecretName")

        def _parse_created_at(data: object) -> datetime.datetime | str:
            try:
                if not isinstance(data, str):
                    raise TypeError()
                created_at_type_1 = isoparse(data)

                return created_at_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.datetime | str, data)

        created_at = _parse_created_at(d.pop("createdAt"))

        def _parse_updated_at(data: object) -> datetime.datetime | str:
            try:
                if not isinstance(data, str):
                    raise TypeError()
                updated_at_type_1 = isoparse(data)

                return updated_at_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.datetime | str, data)

        updated_at = _parse_updated_at(d.pop("updatedAt"))

        put_images_image_id_environment_secrets_response_200 = cls(
            id=id,
            image_id=image_id,
            modal_secret_name=modal_secret_name,
            created_at=created_at,
            updated_at=updated_at,
        )

        put_images_image_id_environment_secrets_response_200.additional_properties = d
        return put_images_image_id_environment_secrets_response_200

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
