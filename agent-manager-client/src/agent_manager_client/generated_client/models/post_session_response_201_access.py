from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="PostSessionResponse201Access")


@_attrs_define
class PostSessionResponse201Access:
    """
    Attributes:
        open_vscode_url (str):
        no_vnc_url (str):
        agent_api_url (str):
        agent_session_id (str):
        agent_auth_token (str):
        agent_auth_expires_in_seconds (int):
    """

    open_vscode_url: str
    no_vnc_url: str
    agent_api_url: str
    agent_session_id: str
    agent_auth_token: str
    agent_auth_expires_in_seconds: int
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        open_vscode_url = self.open_vscode_url

        no_vnc_url = self.no_vnc_url

        agent_api_url = self.agent_api_url

        agent_session_id = self.agent_session_id

        agent_auth_token = self.agent_auth_token

        agent_auth_expires_in_seconds = self.agent_auth_expires_in_seconds

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "openVscodeUrl": open_vscode_url,
                "noVncUrl": no_vnc_url,
                "agentApiUrl": agent_api_url,
                "agentSessionId": agent_session_id,
                "agentAuthToken": agent_auth_token,
                "agentAuthExpiresInSeconds": agent_auth_expires_in_seconds,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        open_vscode_url = d.pop("openVscodeUrl")

        no_vnc_url = d.pop("noVncUrl")

        agent_api_url = d.pop("agentApiUrl")

        agent_session_id = d.pop("agentSessionId")

        agent_auth_token = d.pop("agentAuthToken")

        agent_auth_expires_in_seconds = d.pop("agentAuthExpiresInSeconds")

        post_session_response_201_access = cls(
            open_vscode_url=open_vscode_url,
            no_vnc_url=no_vnc_url,
            agent_api_url=agent_api_url,
            agent_session_id=agent_session_id,
            agent_auth_token=agent_auth_token,
            agent_auth_expires_in_seconds=agent_auth_expires_in_seconds,
        )

        post_session_response_201_access.additional_properties = d
        return post_session_response_201_access

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
