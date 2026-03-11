from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="PostCoordinatorRunsRunIdToolResultBody")


@_attrs_define
class PostCoordinatorRunsRunIdToolResultBody:
    """
    Attributes:
        tool_call_id (str):
        ok (bool):
        result (Any | Unset):
        error (str | Unset):
    """

    tool_call_id: str
    ok: bool
    result: Any | Unset = UNSET
    error: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        tool_call_id = self.tool_call_id

        ok = self.ok

        result = self.result

        error = self.error

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "toolCallId": tool_call_id,
                "ok": ok,
            }
        )
        if result is not UNSET:
            field_dict["result"] = result
        if error is not UNSET:
            field_dict["error"] = error

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        tool_call_id = d.pop("toolCallId")

        ok = d.pop("ok")

        result = d.pop("result", UNSET)

        error = d.pop("error", UNSET)

        post_coordinator_runs_run_id_tool_result_body = cls(
            tool_call_id=tool_call_id,
            ok=ok,
            result=result,
            error=error,
        )

        post_coordinator_runs_run_id_tool_result_body.additional_properties = d
        return post_coordinator_runs_run_id_tool_result_body

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
