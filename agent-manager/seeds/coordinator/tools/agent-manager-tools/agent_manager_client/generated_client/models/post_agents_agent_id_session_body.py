from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="PostAgentsAgentIdSessionBody")


@_attrs_define
class PostAgentsAgentIdSessionBody:
    """
    Attributes:
        message (str):
        session_id (str | Unset):
        title (str | Unset):
        harness (str | Unset):
        model (str | Unset):
        model_reasoning_effort (str | Unset):
    """

    message: str
    session_id: str | Unset = UNSET
    title: str | Unset = UNSET
    harness: str | Unset = UNSET
    model: str | Unset = UNSET
    model_reasoning_effort: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        message = self.message

        session_id = self.session_id

        title = self.title

        harness = self.harness

        model = self.model

        model_reasoning_effort = self.model_reasoning_effort

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "message": message,
            }
        )
        if session_id is not UNSET:
            field_dict["sessionId"] = session_id
        if title is not UNSET:
            field_dict["title"] = title
        if harness is not UNSET:
            field_dict["harness"] = harness
        if model is not UNSET:
            field_dict["model"] = model
        if model_reasoning_effort is not UNSET:
            field_dict["modelReasoningEffort"] = model_reasoning_effort

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        message = d.pop("message")

        session_id = d.pop("sessionId", UNSET)

        title = d.pop("title", UNSET)

        harness = d.pop("harness", UNSET)

        model = d.pop("model", UNSET)

        model_reasoning_effort = d.pop("modelReasoningEffort", UNSET)

        post_agents_agent_id_session_body = cls(
            message=message,
            session_id=session_id,
            title=title,
            harness=harness,
            model=model,
            model_reasoning_effort=model_reasoning_effort,
        )

        return post_agents_agent_id_session_body
