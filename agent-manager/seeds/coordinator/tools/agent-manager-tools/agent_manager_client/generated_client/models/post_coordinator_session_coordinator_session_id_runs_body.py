from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="PostCoordinatorSessionCoordinatorSessionIdRunsBody")


@_attrs_define
class PostCoordinatorSessionCoordinatorSessionIdRunsBody:
    """
    Attributes:
        message (str):
        browser_available (bool | Unset):
    """

    message: str
    browser_available: bool | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        message = self.message

        browser_available = self.browser_available

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "message": message,
            }
        )
        if browser_available is not UNSET:
            field_dict["browserAvailable"] = browser_available

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        message = d.pop("message")

        browser_available = d.pop("browserAvailable", UNSET)

        post_coordinator_session_coordinator_session_id_runs_body = cls(
            message=message,
            browser_available=browser_available,
        )

        post_coordinator_session_coordinator_session_id_runs_body.additional_properties = d
        return post_coordinator_session_coordinator_session_id_runs_body

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
