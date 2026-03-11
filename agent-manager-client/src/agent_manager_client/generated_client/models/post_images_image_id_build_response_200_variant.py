from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field
from dateutil.parser import isoparse

from ..models.post_images_image_id_build_response_200_variant_scope import (
    PostImagesImageIdBuildResponse200VariantScope,
)
from ..types import UNSET, Unset

T = TypeVar("T", bound="PostImagesImageIdBuildResponse200Variant")


@_attrs_define
class PostImagesImageIdBuildResponse200Variant:
    """
    Attributes:
        id (str):
        name (str):
        scope (PostImagesImageIdBuildResponse200VariantScope):
        image_id (str):
        active_image_id (str):
        draft_image_id (str):
        created_at (datetime.datetime | str):
        updated_at (datetime.datetime | str):
        owner_user_id (None | str | Unset):
    """

    id: str
    name: str
    scope: PostImagesImageIdBuildResponse200VariantScope
    image_id: str
    active_image_id: str
    draft_image_id: str
    created_at: datetime.datetime | str
    updated_at: datetime.datetime | str
    owner_user_id: None | str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        name = self.name

        scope = self.scope.value

        image_id = self.image_id

        active_image_id = self.active_image_id

        draft_image_id = self.draft_image_id

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

        owner_user_id: None | str | Unset
        if isinstance(self.owner_user_id, Unset):
            owner_user_id = UNSET
        else:
            owner_user_id = self.owner_user_id

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "name": name,
                "scope": scope,
                "imageId": image_id,
                "activeImageId": active_image_id,
                "draftImageId": draft_image_id,
                "createdAt": created_at,
                "updatedAt": updated_at,
            }
        )
        if owner_user_id is not UNSET:
            field_dict["ownerUserId"] = owner_user_id

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        name = d.pop("name")

        scope = PostImagesImageIdBuildResponse200VariantScope(d.pop("scope"))

        image_id = d.pop("imageId")

        active_image_id = d.pop("activeImageId")

        draft_image_id = d.pop("draftImageId")

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

        def _parse_owner_user_id(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        owner_user_id = _parse_owner_user_id(d.pop("ownerUserId", UNSET))

        post_images_image_id_build_response_200_variant = cls(
            id=id,
            name=name,
            scope=scope,
            image_id=image_id,
            active_image_id=active_image_id,
            draft_image_id=draft_image_id,
            created_at=created_at,
            updated_at=updated_at,
            owner_user_id=owner_user_id,
        )

        post_images_image_id_build_response_200_variant.additional_properties = d
        return post_images_image_id_build_response_200_variant

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
