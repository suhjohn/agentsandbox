from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast
from uuid import UUID

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.get_coordinator_runs_run_id_response_200_status import (
    GetCoordinatorRunsRunIdResponse200Status,
)

T = TypeVar("T", bound="GetCoordinatorRunsRunIdResponse200")


@_attrs_define
class GetCoordinatorRunsRunIdResponse200:
    """
    Attributes:
        run_id (UUID):
        coordinator_session_id (str):
        status (GetCoordinatorRunsRunIdResponse200Status):
        error_message (None | str):
    """

    run_id: UUID
    coordinator_session_id: str
    status: GetCoordinatorRunsRunIdResponse200Status
    error_message: None | str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        run_id = str(self.run_id)

        coordinator_session_id = self.coordinator_session_id

        status = self.status.value

        error_message: None | str
        error_message = self.error_message

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "runId": run_id,
                "coordinatorSessionId": coordinator_session_id,
                "status": status,
                "errorMessage": error_message,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        run_id = UUID(d.pop("runId"))

        coordinator_session_id = d.pop("coordinatorSessionId")

        status = GetCoordinatorRunsRunIdResponse200Status(d.pop("status"))

        def _parse_error_message(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        error_message = _parse_error_message(d.pop("errorMessage"))

        get_coordinator_runs_run_id_response_200 = cls(
            run_id=run_id,
            coordinator_session_id=coordinator_session_id,
            status=status,
            error_message=error_message,
        )

        get_coordinator_runs_run_id_response_200.additional_properties = d
        return get_coordinator_runs_run_id_response_200

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
