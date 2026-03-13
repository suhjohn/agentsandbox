from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.post_agents_agent_id_snapshot_response_200_agent import (
        PostAgentsAgentIdSnapshotResponse200Agent,
    )


T = TypeVar("T", bound="PostAgentsAgentIdSnapshotResponse200")


@_attrs_define
class PostAgentsAgentIdSnapshotResponse200:
    """
    Attributes:
        snapshot_image_id (str):
        agent (PostAgentsAgentIdSnapshotResponse200Agent):
    """

    snapshot_image_id: str
    agent: PostAgentsAgentIdSnapshotResponse200Agent
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        snapshot_image_id = self.snapshot_image_id

        agent = self.agent.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "snapshotImageId": snapshot_image_id,
                "agent": agent,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_agents_agent_id_snapshot_response_200_agent import (
            PostAgentsAgentIdSnapshotResponse200Agent,
        )

        d = dict(src_dict)
        snapshot_image_id = d.pop("snapshotImageId")

        agent = PostAgentsAgentIdSnapshotResponse200Agent.from_dict(d.pop("agent"))

        post_agents_agent_id_snapshot_response_200 = cls(
            snapshot_image_id=snapshot_image_id,
            agent=agent,
        )

        post_agents_agent_id_snapshot_response_200.additional_properties = d
        return post_agents_agent_id_snapshot_response_200

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
