from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast
from uuid import UUID

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="PostApiKeysBody")


@_attrs_define
class PostApiKeysBody:
    """
    Attributes:
        name (str):
        scopes (list[str]):
        agent_id (UUID | Unset):
        expires_in_seconds (int | Unset):
    """

    name: str
    scopes: list[str]
    agent_id: UUID | Unset = UNSET
    expires_in_seconds: int | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        scopes = self.scopes

        agent_id: str | Unset = UNSET
        if not isinstance(self.agent_id, Unset):
            agent_id = str(self.agent_id)

        expires_in_seconds = self.expires_in_seconds

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "name": name,
                "scopes": scopes,
            }
        )
        if agent_id is not UNSET:
            field_dict["agentId"] = agent_id
        if expires_in_seconds is not UNSET:
            field_dict["expiresInSeconds"] = expires_in_seconds

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        name = d.pop("name")

        scopes = cast(list[str], d.pop("scopes"))

        _agent_id = d.pop("agentId", UNSET)
        agent_id: UUID | Unset
        if isinstance(_agent_id, Unset):
            agent_id = UNSET
        else:
            agent_id = UUID(_agent_id)

        expires_in_seconds = d.pop("expiresInSeconds", UNSET)

        post_api_keys_body = cls(
            name=name,
            scopes=scopes,
            agent_id=agent_id,
            expires_in_seconds=expires_in_seconds,
        )

        post_api_keys_body.additional_properties = d
        return post_api_keys_body

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
