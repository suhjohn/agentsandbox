from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast
from uuid import UUID

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="PatchSettingsGlobalResponse200")


@_attrs_define
class PatchSettingsGlobalResponse200:
    """
    Attributes:
        diffignore (list[str]):
        default_coordinator_image_id (None | UUID):
    """

    diffignore: list[str]
    default_coordinator_image_id: None | UUID
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        diffignore = self.diffignore

        default_coordinator_image_id: None | str
        if isinstance(self.default_coordinator_image_id, UUID):
            default_coordinator_image_id = str(self.default_coordinator_image_id)
        else:
            default_coordinator_image_id = self.default_coordinator_image_id

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "diffignore": diffignore,
                "defaultCoordinatorImageId": default_coordinator_image_id,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        diffignore = cast(list[str], d.pop("diffignore"))

        def _parse_default_coordinator_image_id(data: object) -> None | UUID:
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                default_coordinator_image_id_type_0 = UUID(data)

                return default_coordinator_image_id_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | UUID, data)

        default_coordinator_image_id = _parse_default_coordinator_image_id(
            d.pop("defaultCoordinatorImageId")
        )

        patch_settings_global_response_200 = cls(
            diffignore=diffignore,
            default_coordinator_image_id=default_coordinator_image_id,
        )

        patch_settings_global_response_200.additional_properties = d
        return patch_settings_global_response_200

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
