from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.post_auth_register_response_201_user import (
        PostAuthRegisterResponse201User,
    )


T = TypeVar("T", bound="PostAuthRegisterResponse201")


@_attrs_define
class PostAuthRegisterResponse201:
    """
    Attributes:
        user (PostAuthRegisterResponse201User):
        access_token (str):
    """

    user: PostAuthRegisterResponse201User
    access_token: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        user = self.user.to_dict()

        access_token = self.access_token

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "user": user,
                "accessToken": access_token,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_auth_register_response_201_user import (
            PostAuthRegisterResponse201User,
        )

        d = dict(src_dict)
        user = PostAuthRegisterResponse201User.from_dict(d.pop("user"))

        access_token = d.pop("accessToken")

        post_auth_register_response_201 = cls(
            user=user,
            access_token=access_token,
        )

        post_auth_register_response_201.additional_properties = d
        return post_auth_register_response_201

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
