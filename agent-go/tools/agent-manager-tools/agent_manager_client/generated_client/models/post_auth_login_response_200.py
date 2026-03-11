from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.post_auth_login_response_200_user import PostAuthLoginResponse200User


T = TypeVar("T", bound="PostAuthLoginResponse200")


@_attrs_define
class PostAuthLoginResponse200:
    """
    Attributes:
        user (PostAuthLoginResponse200User):
        access_token (str):
    """

    user: PostAuthLoginResponse200User
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
        from ..models.post_auth_login_response_200_user import (
            PostAuthLoginResponse200User,
        )

        d = dict(src_dict)
        user = PostAuthLoginResponse200User.from_dict(d.pop("user"))

        access_token = d.pop("accessToken")

        post_auth_login_response_200 = cls(
            user=user,
            access_token=access_token,
        )

        post_auth_login_response_200.additional_properties = d
        return post_auth_login_response_200

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
