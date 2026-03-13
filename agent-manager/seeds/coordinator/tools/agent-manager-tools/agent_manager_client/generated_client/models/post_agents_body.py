from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast
from uuid import UUID

from attrs import define as _attrs_define

from ..models.post_agents_body_type import PostAgentsBodyType
from ..models.post_agents_body_visibility import PostAgentsBodyVisibility
from ..types import UNSET, Unset

T = TypeVar("T", bound="PostAgentsBody")


@_attrs_define
class PostAgentsBody:
    """
    Attributes:
        image_id (UUID):
        parent_agent_id (UUID | Unset):
        variant_id (UUID | Unset):
        type_ (PostAgentsBodyType | Unset):
        visibility (PostAgentsBodyVisibility | Unset):
        region (list[str] | str | Unset):
    """

    image_id: UUID
    parent_agent_id: UUID | Unset = UNSET
    variant_id: UUID | Unset = UNSET
    type_: PostAgentsBodyType | Unset = UNSET
    visibility: PostAgentsBodyVisibility | Unset = UNSET
    region: list[str] | str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        image_id = str(self.image_id)

        parent_agent_id: str | Unset = UNSET
        if not isinstance(self.parent_agent_id, Unset):
            parent_agent_id = str(self.parent_agent_id)

        variant_id: str | Unset = UNSET
        if not isinstance(self.variant_id, Unset):
            variant_id = str(self.variant_id)

        type_: str | Unset = UNSET
        if not isinstance(self.type_, Unset):
            type_ = self.type_.value

        visibility: str | Unset = UNSET
        if not isinstance(self.visibility, Unset):
            visibility = self.visibility.value

        region: list[str] | str | Unset
        if isinstance(self.region, Unset):
            region = UNSET
        elif isinstance(self.region, list):
            region = self.region

        else:
            region = self.region

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "imageId": image_id,
            }
        )
        if parent_agent_id is not UNSET:
            field_dict["parentAgentId"] = parent_agent_id
        if variant_id is not UNSET:
            field_dict["variantId"] = variant_id
        if type_ is not UNSET:
            field_dict["type"] = type_
        if visibility is not UNSET:
            field_dict["visibility"] = visibility
        if region is not UNSET:
            field_dict["region"] = region

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        image_id = UUID(d.pop("imageId"))

        _parent_agent_id = d.pop("parentAgentId", UNSET)
        parent_agent_id: UUID | Unset
        if isinstance(_parent_agent_id, Unset):
            parent_agent_id = UNSET
        else:
            parent_agent_id = UUID(_parent_agent_id)

        _variant_id = d.pop("variantId", UNSET)
        variant_id: UUID | Unset
        if isinstance(_variant_id, Unset):
            variant_id = UNSET
        else:
            variant_id = UUID(_variant_id)

        _type_ = d.pop("type", UNSET)
        type_: PostAgentsBodyType | Unset
        if isinstance(_type_, Unset):
            type_ = UNSET
        else:
            type_ = PostAgentsBodyType(_type_)

        _visibility = d.pop("visibility", UNSET)
        visibility: PostAgentsBodyVisibility | Unset
        if isinstance(_visibility, Unset):
            visibility = UNSET
        else:
            visibility = PostAgentsBodyVisibility(_visibility)

        def _parse_region(data: object) -> list[str] | str | Unset:
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, list):
                    raise TypeError()
                region_type_1 = cast(list[str], data)

                return region_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(list[str] | str | Unset, data)

        region = _parse_region(d.pop("region", UNSET))

        post_agents_body = cls(
            image_id=image_id,
            parent_agent_id=parent_agent_id,
            variant_id=variant_id,
            type_=type_,
            visibility=visibility,
            region=region,
        )

        return post_agents_body
