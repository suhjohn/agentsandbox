from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast
from uuid import UUID

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="PatchSettingsGlobalBody")


@_attrs_define
class PatchSettingsGlobalBody:
    """
    Attributes:
        diffignore (list[str] | Unset):
        default_coordinator_image_id (None | Unset | UUID):
    """

    diffignore: list[str] | Unset = UNSET
    default_coordinator_image_id: None | Unset | UUID = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        diffignore: list[str] | Unset = UNSET
        if not isinstance(self.diffignore, Unset):
            diffignore = self.diffignore

        default_coordinator_image_id: None | str | Unset
        if isinstance(self.default_coordinator_image_id, Unset):
            default_coordinator_image_id = UNSET
        elif isinstance(self.default_coordinator_image_id, UUID):
            default_coordinator_image_id = str(self.default_coordinator_image_id)
        else:
            default_coordinator_image_id = self.default_coordinator_image_id

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if diffignore is not UNSET:
            field_dict["diffignore"] = diffignore
        if default_coordinator_image_id is not UNSET:
            field_dict["defaultCoordinatorImageId"] = default_coordinator_image_id

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        diffignore = cast(list[str], d.pop("diffignore", UNSET))

        def _parse_default_coordinator_image_id(data: object) -> None | Unset | UUID:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                default_coordinator_image_id_type_0 = UUID(data)

                return default_coordinator_image_id_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | Unset | UUID, data)

        default_coordinator_image_id = _parse_default_coordinator_image_id(
            d.pop("defaultCoordinatorImageId", UNSET)
        )

        patch_settings_global_body = cls(
            diffignore=diffignore,
            default_coordinator_image_id=default_coordinator_image_id,
        )

        patch_settings_global_body.additional_properties = d
        return patch_settings_global_body

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
