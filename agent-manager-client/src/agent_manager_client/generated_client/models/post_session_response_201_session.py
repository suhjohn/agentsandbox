from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="PostSessionResponse201Session")


@_attrs_define
class PostSessionResponse201Session:
    """
    Attributes:
        id (str):
        stream_url (str):
        run_id (str):
        run_stream_url (str):
    """

    id: str
    stream_url: str
    run_id: str
    run_stream_url: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        stream_url = self.stream_url

        run_id = self.run_id

        run_stream_url = self.run_stream_url

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "streamUrl": stream_url,
                "runId": run_id,
                "runStreamUrl": run_stream_url,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        stream_url = d.pop("streamUrl")

        run_id = d.pop("runId")

        run_stream_url = d.pop("runStreamUrl")

        post_session_response_201_session = cls(
            id=id,
            stream_url=stream_url,
            run_id=run_id,
            run_stream_url=run_stream_url,
        )

        post_session_response_201_session.additional_properties = d
        return post_session_response_201_session

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
