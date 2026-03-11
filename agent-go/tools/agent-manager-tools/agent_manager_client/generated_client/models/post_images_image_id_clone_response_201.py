from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, TypeVar, cast
from uuid import UUID

from attrs import define as _attrs_define
from attrs import field as _attrs_field
from dateutil.parser import isoparse

from ..models.post_images_image_id_clone_response_201_visibility import (
    PostImagesImageIdCloneResponse201Visibility,
)
from ..types import UNSET, Unset

T = TypeVar("T", bound="PostImagesImageIdCloneResponse201")


@_attrs_define
class PostImagesImageIdCloneResponse201:
    """
    Attributes:
        id (str):
        visibility (PostImagesImageIdCloneResponse201Visibility):
        name (str):
        created_by (None | str):
        created_at (datetime.datetime | str):
        updated_at (datetime.datetime | str):
        description (None | str | Unset):
        default_variant_id (None | Unset | UUID):
        user_default_variant_id (None | Unset | UUID):
        effective_default_variant_id (None | Unset | UUID):
        deleted_at (datetime.datetime | None | str | Unset):
    """

    id: str
    visibility: PostImagesImageIdCloneResponse201Visibility
    name: str
    created_by: None | str
    created_at: datetime.datetime | str
    updated_at: datetime.datetime | str
    description: None | str | Unset = UNSET
    default_variant_id: None | Unset | UUID = UNSET
    user_default_variant_id: None | Unset | UUID = UNSET
    effective_default_variant_id: None | Unset | UUID = UNSET
    deleted_at: datetime.datetime | None | str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        visibility = self.visibility.value

        name = self.name

        created_by: None | str
        created_by = self.created_by

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

        description: None | str | Unset
        if isinstance(self.description, Unset):
            description = UNSET
        else:
            description = self.description

        default_variant_id: None | str | Unset
        if isinstance(self.default_variant_id, Unset):
            default_variant_id = UNSET
        elif isinstance(self.default_variant_id, UUID):
            default_variant_id = str(self.default_variant_id)
        else:
            default_variant_id = self.default_variant_id

        user_default_variant_id: None | str | Unset
        if isinstance(self.user_default_variant_id, Unset):
            user_default_variant_id = UNSET
        elif isinstance(self.user_default_variant_id, UUID):
            user_default_variant_id = str(self.user_default_variant_id)
        else:
            user_default_variant_id = self.user_default_variant_id

        effective_default_variant_id: None | str | Unset
        if isinstance(self.effective_default_variant_id, Unset):
            effective_default_variant_id = UNSET
        elif isinstance(self.effective_default_variant_id, UUID):
            effective_default_variant_id = str(self.effective_default_variant_id)
        else:
            effective_default_variant_id = self.effective_default_variant_id

        deleted_at: None | str | Unset
        if isinstance(self.deleted_at, Unset):
            deleted_at = UNSET
        elif isinstance(self.deleted_at, datetime.datetime):
            deleted_at = self.deleted_at.isoformat()
        else:
            deleted_at = self.deleted_at

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "visibility": visibility,
                "name": name,
                "createdBy": created_by,
                "createdAt": created_at,
                "updatedAt": updated_at,
            }
        )
        if description is not UNSET:
            field_dict["description"] = description
        if default_variant_id is not UNSET:
            field_dict["defaultVariantId"] = default_variant_id
        if user_default_variant_id is not UNSET:
            field_dict["userDefaultVariantId"] = user_default_variant_id
        if effective_default_variant_id is not UNSET:
            field_dict["effectiveDefaultVariantId"] = effective_default_variant_id
        if deleted_at is not UNSET:
            field_dict["deletedAt"] = deleted_at

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        visibility = PostImagesImageIdCloneResponse201Visibility(d.pop("visibility"))

        name = d.pop("name")

        def _parse_created_by(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        created_by = _parse_created_by(d.pop("createdBy"))

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

        def _parse_description(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        description = _parse_description(d.pop("description", UNSET))

        def _parse_default_variant_id(data: object) -> None | Unset | UUID:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                default_variant_id_type_0 = UUID(data)

                return default_variant_id_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | Unset | UUID, data)

        default_variant_id = _parse_default_variant_id(d.pop("defaultVariantId", UNSET))

        def _parse_user_default_variant_id(data: object) -> None | Unset | UUID:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                user_default_variant_id_type_0 = UUID(data)

                return user_default_variant_id_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | Unset | UUID, data)

        user_default_variant_id = _parse_user_default_variant_id(
            d.pop("userDefaultVariantId", UNSET)
        )

        def _parse_effective_default_variant_id(data: object) -> None | Unset | UUID:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                effective_default_variant_id_type_0 = UUID(data)

                return effective_default_variant_id_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | Unset | UUID, data)

        effective_default_variant_id = _parse_effective_default_variant_id(
            d.pop("effectiveDefaultVariantId", UNSET)
        )

        def _parse_deleted_at(data: object) -> datetime.datetime | None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                deleted_at_type_1 = isoparse(data)

                return deleted_at_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.datetime | None | str | Unset, data)

        deleted_at = _parse_deleted_at(d.pop("deletedAt", UNSET))

        post_images_image_id_clone_response_201 = cls(
            id=id,
            visibility=visibility,
            name=name,
            created_by=created_by,
            created_at=created_at,
            updated_at=updated_at,
            description=description,
            default_variant_id=default_variant_id,
            user_default_variant_id=user_default_variant_id,
            effective_default_variant_id=effective_default_variant_id,
            deleted_at=deleted_at,
        )

        post_images_image_id_clone_response_201.additional_properties = d
        return post_images_image_id_clone_response_201

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
