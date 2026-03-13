from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.post_session_response_201_access import PostSessionResponse201Access
    from ..models.post_session_response_201_agent import PostSessionResponse201Agent
    from ..models.post_session_response_201_session import PostSessionResponse201Session


T = TypeVar("T", bound="PostSessionResponse201")


@_attrs_define
class PostSessionResponse201:
    """
    Attributes:
        agent (PostSessionResponse201Agent):
        session (PostSessionResponse201Session):
        access (PostSessionResponse201Access):
    """

    agent: PostSessionResponse201Agent
    session: PostSessionResponse201Session
    access: PostSessionResponse201Access
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        agent = self.agent.to_dict()

        session = self.session.to_dict()

        access = self.access.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "agent": agent,
                "session": session,
                "access": access,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_session_response_201_access import (
            PostSessionResponse201Access,
        )
        from ..models.post_session_response_201_agent import PostSessionResponse201Agent
        from ..models.post_session_response_201_session import (
            PostSessionResponse201Session,
        )

        d = dict(src_dict)
        agent = PostSessionResponse201Agent.from_dict(d.pop("agent"))

        session = PostSessionResponse201Session.from_dict(d.pop("session"))

        access = PostSessionResponse201Access.from_dict(d.pop("access"))

        post_session_response_201 = cls(
            agent=agent,
            session=session,
            access=access,
        )

        post_session_response_201.additional_properties = d
        return post_session_response_201

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
