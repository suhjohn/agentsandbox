from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.get_users_me_response_200_workspace_keybindings_type_0 import (
        GetUsersMeResponse200WorkspaceKeybindingsType0,
    )


T = TypeVar("T", bound="GetUsersMeResponse200")


@_attrs_define
class GetUsersMeResponse200:
    """
    Attributes:
        id (str):
        email (str):
        name (str):
        avatar (None | str):
        default_region (list[str] | str):
        workspace_keybindings (GetUsersMeResponse200WorkspaceKeybindingsType0 | None):
    """

    id: str
    email: str
    name: str
    avatar: None | str
    default_region: list[str] | str
    workspace_keybindings: GetUsersMeResponse200WorkspaceKeybindingsType0 | None
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.get_users_me_response_200_workspace_keybindings_type_0 import (
            GetUsersMeResponse200WorkspaceKeybindingsType0,
        )

        id = self.id

        email = self.email

        name = self.name

        avatar: None | str
        avatar = self.avatar

        default_region: list[str] | str
        if isinstance(self.default_region, list):
            default_region = self.default_region

        else:
            default_region = self.default_region

        workspace_keybindings: dict[str, Any] | None
        if isinstance(
            self.workspace_keybindings, GetUsersMeResponse200WorkspaceKeybindingsType0
        ):
            workspace_keybindings = self.workspace_keybindings.to_dict()
        else:
            workspace_keybindings = self.workspace_keybindings

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "email": email,
                "name": name,
                "avatar": avatar,
                "defaultRegion": default_region,
                "workspaceKeybindings": workspace_keybindings,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_users_me_response_200_workspace_keybindings_type_0 import (
            GetUsersMeResponse200WorkspaceKeybindingsType0,
        )

        d = dict(src_dict)
        id = d.pop("id")

        email = d.pop("email")

        name = d.pop("name")

        def _parse_avatar(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        avatar = _parse_avatar(d.pop("avatar"))

        def _parse_default_region(data: object) -> list[str] | str:
            try:
                if not isinstance(data, list):
                    raise TypeError()
                default_region_type_1 = cast(list[str], data)

                return default_region_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(list[str] | str, data)

        default_region = _parse_default_region(d.pop("defaultRegion"))

        def _parse_workspace_keybindings(
            data: object,
        ) -> GetUsersMeResponse200WorkspaceKeybindingsType0 | None:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                workspace_keybindings_type_0 = (
                    GetUsersMeResponse200WorkspaceKeybindingsType0.from_dict(data)
                )

                return workspace_keybindings_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(GetUsersMeResponse200WorkspaceKeybindingsType0 | None, data)

        workspace_keybindings = _parse_workspace_keybindings(
            d.pop("workspaceKeybindings")
        )

        get_users_me_response_200 = cls(
            id=id,
            email=email,
            name=name,
            avatar=avatar,
            default_region=default_region,
            workspace_keybindings=workspace_keybindings,
        )

        get_users_me_response_200.additional_properties = d
        return get_users_me_response_200

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
