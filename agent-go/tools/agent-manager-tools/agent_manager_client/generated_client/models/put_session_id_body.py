from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast
from uuid import UUID

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="PutSessionIdBody")


@_attrs_define
class PutSessionIdBody:
    """
    Attributes:
        agent_id (str | UUID):
        is_archived (bool | Unset):
        status (str | Unset): Cosmetic session status for human filtering. Suggested values: initial, processing,
            blocked (agent needs human input to continue with todos), completed (no next todo).
        harness (str | Unset):
        external_session_id (None | str | Unset):
        title (None | str | Unset):
        first_user_message_body (None | str | Unset):
        last_message_body (None | str | Unset):
        model (None | str | Unset):
        model_reasoning_effort (None | str | Unset):
    """

    agent_id: str | UUID
    is_archived: bool | Unset = UNSET
    status: str | Unset = UNSET
    harness: str | Unset = UNSET
    external_session_id: None | str | Unset = UNSET
    title: None | str | Unset = UNSET
    first_user_message_body: None | str | Unset = UNSET
    last_message_body: None | str | Unset = UNSET
    model: None | str | Unset = UNSET
    model_reasoning_effort: None | str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        agent_id: str
        if isinstance(self.agent_id, UUID):
            agent_id = str(self.agent_id)
        else:
            agent_id = self.agent_id

        is_archived = self.is_archived

        status = self.status

        harness = self.harness

        external_session_id: None | str | Unset
        if isinstance(self.external_session_id, Unset):
            external_session_id = UNSET
        else:
            external_session_id = self.external_session_id

        title: None | str | Unset
        if isinstance(self.title, Unset):
            title = UNSET
        else:
            title = self.title

        first_user_message_body: None | str | Unset
        if isinstance(self.first_user_message_body, Unset):
            first_user_message_body = UNSET
        else:
            first_user_message_body = self.first_user_message_body

        last_message_body: None | str | Unset
        if isinstance(self.last_message_body, Unset):
            last_message_body = UNSET
        else:
            last_message_body = self.last_message_body

        model: None | str | Unset
        if isinstance(self.model, Unset):
            model = UNSET
        else:
            model = self.model

        model_reasoning_effort: None | str | Unset
        if isinstance(self.model_reasoning_effort, Unset):
            model_reasoning_effort = UNSET
        else:
            model_reasoning_effort = self.model_reasoning_effort

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "agentId": agent_id,
            }
        )
        if is_archived is not UNSET:
            field_dict["isArchived"] = is_archived
        if status is not UNSET:
            field_dict["status"] = status
        if harness is not UNSET:
            field_dict["harness"] = harness
        if external_session_id is not UNSET:
            field_dict["externalSessionId"] = external_session_id
        if title is not UNSET:
            field_dict["title"] = title
        if first_user_message_body is not UNSET:
            field_dict["firstUserMessageBody"] = first_user_message_body
        if last_message_body is not UNSET:
            field_dict["lastMessageBody"] = last_message_body
        if model is not UNSET:
            field_dict["model"] = model
        if model_reasoning_effort is not UNSET:
            field_dict["modelReasoningEffort"] = model_reasoning_effort

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)

        def _parse_agent_id(data: object) -> str | UUID:
            try:
                if not isinstance(data, str):
                    raise TypeError()
                agent_id_type_0 = UUID(data)

                return agent_id_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(str | UUID, data)

        agent_id = _parse_agent_id(d.pop("agentId"))

        is_archived = d.pop("isArchived", UNSET)

        status = d.pop("status", UNSET)

        harness = d.pop("harness", UNSET)

        def _parse_external_session_id(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        external_session_id = _parse_external_session_id(
            d.pop("externalSessionId", UNSET)
        )

        def _parse_title(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        title = _parse_title(d.pop("title", UNSET))

        def _parse_first_user_message_body(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        first_user_message_body = _parse_first_user_message_body(
            d.pop("firstUserMessageBody", UNSET)
        )

        def _parse_last_message_body(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        last_message_body = _parse_last_message_body(d.pop("lastMessageBody", UNSET))

        def _parse_model(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        model = _parse_model(d.pop("model", UNSET))

        def _parse_model_reasoning_effort(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        model_reasoning_effort = _parse_model_reasoning_effort(
            d.pop("modelReasoningEffort", UNSET)
        )

        put_session_id_body = cls(
            agent_id=agent_id,
            is_archived=is_archived,
            status=status,
            harness=harness,
            external_session_id=external_session_id,
            title=title,
            first_user_message_body=first_user_message_body,
            last_message_body=last_message_body,
            model=model,
            model_reasoning_effort=model_reasoning_effort,
        )

        put_session_id_body.additional_properties = d
        return put_session_id_body

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
