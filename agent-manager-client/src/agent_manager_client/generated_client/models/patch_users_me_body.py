from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.patch_users_me_body_workspace_keybindings_type_0 import (
        PatchUsersMeBodyWorkspaceKeybindingsType0,
    )


T = TypeVar("T", bound="PatchUsersMeBody")


@_attrs_define
class PatchUsersMeBody:
    """
    Attributes:
        name (str | Unset):
        default_region (list[str] | str | Unset):
        workspace_keybindings (None | PatchUsersMeBodyWorkspaceKeybindingsType0 | Unset):
    """

    name: str | Unset = UNSET
    default_region: list[str] | str | Unset = UNSET
    workspace_keybindings: None | PatchUsersMeBodyWorkspaceKeybindingsType0 | Unset = (
        UNSET
    )
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.patch_users_me_body_workspace_keybindings_type_0 import (
            PatchUsersMeBodyWorkspaceKeybindingsType0,
        )

        name = self.name

        default_region: list[str] | str | Unset
        if isinstance(self.default_region, Unset):
            default_region = UNSET
        elif isinstance(self.default_region, list):
            default_region = self.default_region

        else:
            default_region = self.default_region

        workspace_keybindings: dict[str, Any] | None | Unset
        if isinstance(self.workspace_keybindings, Unset):
            workspace_keybindings = UNSET
        elif isinstance(
            self.workspace_keybindings, PatchUsersMeBodyWorkspaceKeybindingsType0
        ):
            workspace_keybindings = self.workspace_keybindings.to_dict()
        else:
            workspace_keybindings = self.workspace_keybindings

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if name is not UNSET:
            field_dict["name"] = name
        if default_region is not UNSET:
            field_dict["defaultRegion"] = default_region
        if workspace_keybindings is not UNSET:
            field_dict["workspaceKeybindings"] = workspace_keybindings

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.patch_users_me_body_workspace_keybindings_type_0 import (
            PatchUsersMeBodyWorkspaceKeybindingsType0,
        )

        d = dict(src_dict)
        name = d.pop("name", UNSET)

        def _parse_default_region(data: object) -> list[str] | str | Unset:
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, list):
                    raise TypeError()
                default_region_type_1 = cast(list[str], data)

                return default_region_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(list[str] | str | Unset, data)

        default_region = _parse_default_region(d.pop("defaultRegion", UNSET))

        def _parse_workspace_keybindings(
            data: object,
        ) -> None | PatchUsersMeBodyWorkspaceKeybindingsType0 | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                workspace_keybindings_type_0 = (
                    PatchUsersMeBodyWorkspaceKeybindingsType0.from_dict(data)
                )

                return workspace_keybindings_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | PatchUsersMeBodyWorkspaceKeybindingsType0 | Unset, data)

        workspace_keybindings = _parse_workspace_keybindings(
            d.pop("workspaceKeybindings", UNSET)
        )

        patch_users_me_body = cls(
            name=name,
            default_region=default_region,
            workspace_keybindings=workspace_keybindings,
        )

        patch_users_me_body.additional_properties = d
        return patch_users_me_body

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
