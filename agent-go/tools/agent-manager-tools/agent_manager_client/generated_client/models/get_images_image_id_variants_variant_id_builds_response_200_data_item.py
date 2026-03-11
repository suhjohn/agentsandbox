from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, TypeVar, cast
from uuid import UUID

from attrs import define as _attrs_define
from attrs import field as _attrs_field
from dateutil.parser import isoparse

from ..models.get_images_image_id_variants_variant_id_builds_response_200_data_item_status import (
    GetImagesImageIdVariantsVariantIdBuildsResponse200DataItemStatus,
)

T = TypeVar("T", bound="GetImagesImageIdVariantsVariantIdBuildsResponse200DataItem")


@_attrs_define
class GetImagesImageIdVariantsVariantIdBuildsResponse200DataItem:
    """
    Attributes:
        id (UUID):
        image_id (UUID):
        variant_id (UUID):
        requested_by_user_id (None | UUID):
        status (GetImagesImageIdVariantsVariantIdBuildsResponse200DataItemStatus):
        input_hash (str):
        base_image_id (None | str):
        output_image_id (None | str):
        error_message (None | str):
        started_at (datetime.datetime | str):
        finished_at (datetime.datetime | None | str):
        created_at (datetime.datetime | str):
        updated_at (datetime.datetime | str):
    """

    id: UUID
    image_id: UUID
    variant_id: UUID
    requested_by_user_id: None | UUID
    status: GetImagesImageIdVariantsVariantIdBuildsResponse200DataItemStatus
    input_hash: str
    base_image_id: None | str
    output_image_id: None | str
    error_message: None | str
    started_at: datetime.datetime | str
    finished_at: datetime.datetime | None | str
    created_at: datetime.datetime | str
    updated_at: datetime.datetime | str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = str(self.id)

        image_id = str(self.image_id)

        variant_id = str(self.variant_id)

        requested_by_user_id: None | str
        if isinstance(self.requested_by_user_id, UUID):
            requested_by_user_id = str(self.requested_by_user_id)
        else:
            requested_by_user_id = self.requested_by_user_id

        status = self.status.value

        input_hash = self.input_hash

        base_image_id: None | str
        base_image_id = self.base_image_id

        output_image_id: None | str
        output_image_id = self.output_image_id

        error_message: None | str
        error_message = self.error_message

        started_at: str
        if isinstance(self.started_at, datetime.datetime):
            started_at = self.started_at.isoformat()
        else:
            started_at = self.started_at

        finished_at: None | str
        if isinstance(self.finished_at, datetime.datetime):
            finished_at = self.finished_at.isoformat()
        else:
            finished_at = self.finished_at

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
                "imageId": image_id,
                "variantId": variant_id,
                "requestedByUserId": requested_by_user_id,
                "status": status,
                "inputHash": input_hash,
                "baseImageId": base_image_id,
                "outputImageId": output_image_id,
                "errorMessage": error_message,
                "startedAt": started_at,
                "finishedAt": finished_at,
                "createdAt": created_at,
                "updatedAt": updated_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = UUID(d.pop("id"))

        image_id = UUID(d.pop("imageId"))

        variant_id = UUID(d.pop("variantId"))

        def _parse_requested_by_user_id(data: object) -> None | UUID:
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                requested_by_user_id_type_0 = UUID(data)

                return requested_by_user_id_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | UUID, data)

        requested_by_user_id = _parse_requested_by_user_id(d.pop("requestedByUserId"))

        status = GetImagesImageIdVariantsVariantIdBuildsResponse200DataItemStatus(
            d.pop("status")
        )

        input_hash = d.pop("inputHash")

        def _parse_base_image_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        base_image_id = _parse_base_image_id(d.pop("baseImageId"))

        def _parse_output_image_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        output_image_id = _parse_output_image_id(d.pop("outputImageId"))

        def _parse_error_message(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        error_message = _parse_error_message(d.pop("errorMessage"))

        def _parse_started_at(data: object) -> datetime.datetime | str:
            try:
                if not isinstance(data, str):
                    raise TypeError()
                started_at_type_1 = isoparse(data)

                return started_at_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.datetime | str, data)

        started_at = _parse_started_at(d.pop("startedAt"))

        def _parse_finished_at(data: object) -> datetime.datetime | None | str:
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                finished_at_type_1 = isoparse(data)

                return finished_at_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.datetime | None | str, data)

        finished_at = _parse_finished_at(d.pop("finishedAt"))

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

        get_images_image_id_variants_variant_id_builds_response_200_data_item = cls(
            id=id,
            image_id=image_id,
            variant_id=variant_id,
            requested_by_user_id=requested_by_user_id,
            status=status,
            input_hash=input_hash,
            base_image_id=base_image_id,
            output_image_id=output_image_id,
            error_message=error_message,
            started_at=started_at,
            finished_at=finished_at,
            created_at=created_at,
            updated_at=updated_at,
        )

        get_images_image_id_variants_variant_id_builds_response_200_data_item.additional_properties = d
        return get_images_image_id_variants_variant_id_builds_response_200_data_item

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
