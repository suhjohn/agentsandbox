from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.post_api_keys_response_201_api_key import PostApiKeysResponse201ApiKey


T = TypeVar("T", bound="PostApiKeysResponse201")


@_attrs_define
class PostApiKeysResponse201:
    """
    Attributes:
        key (str):
        api_key (PostApiKeysResponse201ApiKey):
    """

    key: str
    api_key: PostApiKeysResponse201ApiKey
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        key = self.key

        api_key = self.api_key.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "key": key,
                "apiKey": api_key,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_keys_response_201_api_key import (
            PostApiKeysResponse201ApiKey,
        )

        d = dict(src_dict)
        key = d.pop("key")

        api_key = PostApiKeysResponse201ApiKey.from_dict(d.pop("apiKey"))

        post_api_keys_response_201 = cls(
            key=key,
            api_key=api_key,
        )

        post_api_keys_response_201.additional_properties = d
        return post_api_keys_response_201

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
