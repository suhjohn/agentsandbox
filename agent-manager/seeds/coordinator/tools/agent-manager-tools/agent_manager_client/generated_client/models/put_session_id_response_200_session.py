from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field
from dateutil.parser import isoparse

T = TypeVar("T", bound="PutSessionIdResponse200Session")


@_attrs_define
class PutSessionIdResponse200Session:
    """
    Attributes:
        id (str):
        agent_id (str):
        image_id (None | str):
        created_by (str):
        status (str): Cosmetic session status for human filtering. Suggested values: initial, processing, blocked (agent
            needs human input to continue with todos), completed (no next todo).
        is_archived (bool):
        harness (str):
        external_session_id (None | str):
        title (None | str):
        first_user_message_body (None | str):
        last_message_body (None | str):
        model (None | str):
        model_reasoning_effort (None | str):
        created_at (datetime.datetime | str):
        updated_at (datetime.datetime | str):
    """

    id: str
    agent_id: str
    image_id: None | str
    created_by: str
    status: str
    is_archived: bool
    harness: str
    external_session_id: None | str
    title: None | str
    first_user_message_body: None | str
    last_message_body: None | str
    model: None | str
    model_reasoning_effort: None | str
    created_at: datetime.datetime | str
    updated_at: datetime.datetime | str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        agent_id = self.agent_id

        image_id: None | str
        image_id = self.image_id

        created_by = self.created_by

        status = self.status

        is_archived = self.is_archived

        harness = self.harness

        external_session_id: None | str
        external_session_id = self.external_session_id

        title: None | str
        title = self.title

        first_user_message_body: None | str
        first_user_message_body = self.first_user_message_body

        last_message_body: None | str
        last_message_body = self.last_message_body

        model: None | str
        model = self.model

        model_reasoning_effort: None | str
        model_reasoning_effort = self.model_reasoning_effort

        created_at: str
        if isinstance(self.created_at, datetime.datetime):
            created_at = self.created_at.isoformat()
        else:
            created_at = self.created_at

        updated_at: str
        if isinstance(self.updated_at, datetime.datetime):
            updated_at = self.updated_at.isoformat()
        else:
            updated_at = self.updated_at

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "agentId": agent_id,
                "imageId": image_id,
                "createdBy": created_by,
                "status": status,
                "isArchived": is_archived,
                "harness": harness,
                "externalSessionId": external_session_id,
                "title": title,
                "firstUserMessageBody": first_user_message_body,
                "lastMessageBody": last_message_body,
                "model": model,
                "modelReasoningEffort": model_reasoning_effort,
                "createdAt": created_at,
                "updatedAt": updated_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        agent_id = d.pop("agentId")

        def _parse_image_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        image_id = _parse_image_id(d.pop("imageId"))

        created_by = d.pop("createdBy")

        status = d.pop("status")

        is_archived = d.pop("isArchived")

        harness = d.pop("harness")

        def _parse_external_session_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        external_session_id = _parse_external_session_id(d.pop("externalSessionId"))

        def _parse_title(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        title = _parse_title(d.pop("title"))

        def _parse_first_user_message_body(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        first_user_message_body = _parse_first_user_message_body(
            d.pop("firstUserMessageBody")
        )

        def _parse_last_message_body(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        last_message_body = _parse_last_message_body(d.pop("lastMessageBody"))

        def _parse_model(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        model = _parse_model(d.pop("model"))

        def _parse_model_reasoning_effort(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        model_reasoning_effort = _parse_model_reasoning_effort(
            d.pop("modelReasoningEffort")
        )

        def _parse_created_at(data: object) -> datetime.datetime | str:
            try:
                if not isinstance(data, str):
                    raise TypeError()
                created_at_type_1 = isoparse(data)

                return created_at_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.datetime | str, data)

        created_at = _parse_created_at(d.pop("createdAt"))

        def _parse_updated_at(data: object) -> datetime.datetime | str:
            try:
                if not isinstance(data, str):
                    raise TypeError()
                updated_at_type_1 = isoparse(data)

                return updated_at_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.datetime | str, data)

        updated_at = _parse_updated_at(d.pop("updatedAt"))

        put_session_id_response_200_session = cls(
            id=id,
            agent_id=agent_id,
            image_id=image_id,
            created_by=created_by,
            status=status,
            is_archived=is_archived,
            harness=harness,
            external_session_id=external_session_id,
            title=title,
            first_user_message_body=first_user_message_body,
            last_message_body=last_message_body,
            model=model,
            model_reasoning_effort=model_reasoning_effort,
            created_at=created_at,
            updated_at=updated_at,
        )

        put_session_id_response_200_session.additional_properties = d
        return put_session_id_response_200_session

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
