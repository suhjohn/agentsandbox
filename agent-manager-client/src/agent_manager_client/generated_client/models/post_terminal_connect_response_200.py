from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.post_terminal_connect_response_200_target_type import (
    PostTerminalConnectResponse200TargetType,
)

T = TypeVar("T", bound="PostTerminalConnectResponse200")


@_attrs_define
class PostTerminalConnectResponse200:
    """
    Attributes:
        target_type (PostTerminalConnectResponse200TargetType):
        target_id (str):
        sandbox_id (str):
        terminal_url (str):
        auth_token (str):
        auth_token_expires_in_seconds (int):
        ws_url (str):
    """

    target_type: PostTerminalConnectResponse200TargetType
    target_id: str
    sandbox_id: str
    terminal_url: str
    auth_token: str
    auth_token_expires_in_seconds: int
    ws_url: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        target_type = self.target_type.value

        target_id = self.target_id

        sandbox_id = self.sandbox_id

        terminal_url = self.terminal_url

        auth_token = self.auth_token

        auth_token_expires_in_seconds = self.auth_token_expires_in_seconds

        ws_url = self.ws_url

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "targetType": target_type,
                "targetId": target_id,
                "sandboxId": sandbox_id,
                "terminalUrl": terminal_url,
                "authToken": auth_token,
                "authTokenExpiresInSeconds": auth_token_expires_in_seconds,
                "wsUrl": ws_url,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        target_type = PostTerminalConnectResponse200TargetType(d.pop("targetType"))

        target_id = d.pop("targetId")

        sandbox_id = d.pop("sandboxId")

        terminal_url = d.pop("terminalUrl")

        auth_token = d.pop("authToken")

        auth_token_expires_in_seconds = d.pop("authTokenExpiresInSeconds")

        ws_url = d.pop("wsUrl")

        post_terminal_connect_response_200 = cls(
            target_type=target_type,
            target_id=target_id,
            sandbox_id=sandbox_id,
            terminal_url=terminal_url,
            auth_token=auth_token,
            auth_token_expires_in_seconds=auth_token_expires_in_seconds,
            ws_url=ws_url,
        )

        post_terminal_connect_response_200.additional_properties = d
        return post_terminal_connect_response_200

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
