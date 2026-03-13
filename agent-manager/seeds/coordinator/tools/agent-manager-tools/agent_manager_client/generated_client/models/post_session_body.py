from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast
from uuid import UUID

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="PostSessionBody")


@_attrs_define
class PostSessionBody:
    """
    Attributes:
        image_id (str | UUID):
        message (str):
        parent_agent_id (str | Unset | UUID):
        variant_id (str | Unset | UUID):
        region (list[str] | str | Unset):
        title (str | Unset):
        harness (str | Unset):
        model (str | Unset):
        model_reasoning_effort (str | Unset):
    """

    image_id: str | UUID
    message: str
    parent_agent_id: str | Unset | UUID = UNSET
    variant_id: str | Unset | UUID = UNSET
    region: list[str] | str | Unset = UNSET
    title: str | Unset = UNSET
    harness: str | Unset = UNSET
    model: str | Unset = UNSET
    model_reasoning_effort: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        image_id: str
        if isinstance(self.image_id, UUID):
            image_id = str(self.image_id)
        else:
            image_id = self.image_id

        message = self.message

        parent_agent_id: str | Unset
        if isinstance(self.parent_agent_id, Unset):
            parent_agent_id = UNSET
        elif isinstance(self.parent_agent_id, UUID):
            parent_agent_id = str(self.parent_agent_id)
        else:
            parent_agent_id = self.parent_agent_id

        variant_id: str | Unset
        if isinstance(self.variant_id, Unset):
            variant_id = UNSET
        elif isinstance(self.variant_id, UUID):
            variant_id = str(self.variant_id)
        else:
            variant_id = self.variant_id

        region: list[str] | str | Unset
        if isinstance(self.region, Unset):
            region = UNSET
        elif isinstance(self.region, list):
            region = self.region

        else:
            region = self.region

        title = self.title

        harness = self.harness

        model = self.model

        model_reasoning_effort = self.model_reasoning_effort

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "imageId": image_id,
                "message": message,
            }
        )
        if parent_agent_id is not UNSET:
            field_dict["parentAgentId"] = parent_agent_id
        if variant_id is not UNSET:
            field_dict["variantId"] = variant_id
        if region is not UNSET:
            field_dict["region"] = region
        if title is not UNSET:
            field_dict["title"] = title
        if harness is not UNSET:
            field_dict["harness"] = harness
        if model is not UNSET:
            field_dict["model"] = model
        if model_reasoning_effort is not UNSET:
            field_dict["modelReasoningEffort"] = model_reasoning_effort

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)

        def _parse_image_id(data: object) -> str | UUID:
            try:
                if not isinstance(data, str):
                    raise TypeError()
                image_id_type_0 = UUID(data)

                return image_id_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(str | UUID, data)

        image_id = _parse_image_id(d.pop("imageId"))

        message = d.pop("message")

        def _parse_parent_agent_id(data: object) -> str | Unset | UUID:
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                parent_agent_id_type_0 = UUID(data)

                return parent_agent_id_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(str | Unset | UUID, data)

        parent_agent_id = _parse_parent_agent_id(d.pop("parentAgentId", UNSET))

        def _parse_variant_id(data: object) -> str | Unset | UUID:
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                variant_id_type_0 = UUID(data)

                return variant_id_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(str | Unset | UUID, data)

        variant_id = _parse_variant_id(d.pop("variantId", UNSET))

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

        title = d.pop("title", UNSET)

        harness = d.pop("harness", UNSET)

        model = d.pop("model", UNSET)

        model_reasoning_effort = d.pop("modelReasoningEffort", UNSET)

        post_session_body = cls(
            image_id=image_id,
            message=message,
            parent_agent_id=parent_agent_id,
            variant_id=variant_id,
            region=region,
            title=title,
            harness=harness,
            model=model,
            model_reasoning_effort=model_reasoning_effort,
        )

        return post_session_body
