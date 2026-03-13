from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast
from uuid import UUID

from attrs import define as _attrs_define
from attrs import field as _attrs_field
from dateutil.parser import isoparse

from ..models.post_agents_agent_id_snapshot_response_200_agent_status import (
    PostAgentsAgentIdSnapshotResponse200AgentStatus,
)
from ..models.post_agents_agent_id_snapshot_response_200_agent_type import (
    PostAgentsAgentIdSnapshotResponse200AgentType,
)
from ..models.post_agents_agent_id_snapshot_response_200_agent_visibility import (
    PostAgentsAgentIdSnapshotResponse200AgentVisibility,
)
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_agents_agent_id_snapshot_response_200_agent_created_by_user_type_0 import (
        PostAgentsAgentIdSnapshotResponse200AgentCreatedByUserType0,
    )
    from ..models.post_agents_agent_id_snapshot_response_200_agent_image_type_0 import (
        PostAgentsAgentIdSnapshotResponse200AgentImageType0,
    )


T = TypeVar("T", bound="PostAgentsAgentIdSnapshotResponse200Agent")


@_attrs_define
class PostAgentsAgentIdSnapshotResponse200Agent:
    """
    Attributes:
        id (str):
        name (str):
        type_ (PostAgentsAgentIdSnapshotResponse200AgentType):
        visibility (PostAgentsAgentIdSnapshotResponse200AgentVisibility):
        status (PostAgentsAgentIdSnapshotResponse200AgentStatus):
        created_by (None | str):
        created_by_user (None | PostAgentsAgentIdSnapshotResponse200AgentCreatedByUserType0):
        created_at (datetime.datetime | str):
        updated_at (datetime.datetime | str):
        parent_agent_id (None | Unset | UUID):
        image_id (None | str | Unset):
        image_variant_id (None | Unset | UUID):
        image (None | PostAgentsAgentIdSnapshotResponse200AgentImageType0 | Unset):
        current_sandbox_id (None | str | Unset):
        sandbox_name (None | str | Unset):
        snapshot_image_id (None | str | Unset):
        region (None | str | Unset):
    """

    id: str
    name: str
    type_: PostAgentsAgentIdSnapshotResponse200AgentType
    visibility: PostAgentsAgentIdSnapshotResponse200AgentVisibility
    status: PostAgentsAgentIdSnapshotResponse200AgentStatus
    created_by: None | str
    created_by_user: None | PostAgentsAgentIdSnapshotResponse200AgentCreatedByUserType0
    created_at: datetime.datetime | str
    updated_at: datetime.datetime | str
    parent_agent_id: None | Unset | UUID = UNSET
    image_id: None | str | Unset = UNSET
    image_variant_id: None | Unset | UUID = UNSET
    image: None | PostAgentsAgentIdSnapshotResponse200AgentImageType0 | Unset = UNSET
    current_sandbox_id: None | str | Unset = UNSET
    sandbox_name: None | str | Unset = UNSET
    snapshot_image_id: None | str | Unset = UNSET
    region: None | str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.post_agents_agent_id_snapshot_response_200_agent_created_by_user_type_0 import (
            PostAgentsAgentIdSnapshotResponse200AgentCreatedByUserType0,
        )
        from ..models.post_agents_agent_id_snapshot_response_200_agent_image_type_0 import (
            PostAgentsAgentIdSnapshotResponse200AgentImageType0,
        )

        id = self.id

        name = self.name

        type_ = self.type_.value

        visibility = self.visibility.value

        status = self.status.value

        created_by: None | str
        created_by = self.created_by

        created_by_user: dict[str, Any] | None
        if isinstance(
            self.created_by_user,
            PostAgentsAgentIdSnapshotResponse200AgentCreatedByUserType0,
        ):
            created_by_user = self.created_by_user.to_dict()
        else:
            created_by_user = self.created_by_user

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

        parent_agent_id: None | str | Unset
        if isinstance(self.parent_agent_id, Unset):
            parent_agent_id = UNSET
        elif isinstance(self.parent_agent_id, UUID):
            parent_agent_id = str(self.parent_agent_id)
        else:
            parent_agent_id = self.parent_agent_id

        image_id: None | str | Unset
        if isinstance(self.image_id, Unset):
            image_id = UNSET
        else:
            image_id = self.image_id

        image_variant_id: None | str | Unset
        if isinstance(self.image_variant_id, Unset):
            image_variant_id = UNSET
        elif isinstance(self.image_variant_id, UUID):
            image_variant_id = str(self.image_variant_id)
        else:
            image_variant_id = self.image_variant_id

        image: dict[str, Any] | None | Unset
        if isinstance(self.image, Unset):
            image = UNSET
        elif isinstance(
            self.image, PostAgentsAgentIdSnapshotResponse200AgentImageType0
        ):
            image = self.image.to_dict()
        else:
            image = self.image

        current_sandbox_id: None | str | Unset
        if isinstance(self.current_sandbox_id, Unset):
            current_sandbox_id = UNSET
        else:
            current_sandbox_id = self.current_sandbox_id

        sandbox_name: None | str | Unset
        if isinstance(self.sandbox_name, Unset):
            sandbox_name = UNSET
        else:
            sandbox_name = self.sandbox_name

        snapshot_image_id: None | str | Unset
        if isinstance(self.snapshot_image_id, Unset):
            snapshot_image_id = UNSET
        else:
            snapshot_image_id = self.snapshot_image_id

        region: None | str | Unset
        if isinstance(self.region, Unset):
            region = UNSET
        else:
            region = self.region

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "name": name,
                "type": type_,
                "visibility": visibility,
                "status": status,
                "createdBy": created_by,
                "createdByUser": created_by_user,
                "createdAt": created_at,
                "updatedAt": updated_at,
            }
        )
        if parent_agent_id is not UNSET:
            field_dict["parentAgentId"] = parent_agent_id
        if image_id is not UNSET:
            field_dict["imageId"] = image_id
        if image_variant_id is not UNSET:
            field_dict["imageVariantId"] = image_variant_id
        if image is not UNSET:
            field_dict["image"] = image
        if current_sandbox_id is not UNSET:
            field_dict["currentSandboxId"] = current_sandbox_id
        if sandbox_name is not UNSET:
            field_dict["sandboxName"] = sandbox_name
        if snapshot_image_id is not UNSET:
            field_dict["snapshotImageId"] = snapshot_image_id
        if region is not UNSET:
            field_dict["region"] = region

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_agents_agent_id_snapshot_response_200_agent_created_by_user_type_0 import (
            PostAgentsAgentIdSnapshotResponse200AgentCreatedByUserType0,
        )
        from ..models.post_agents_agent_id_snapshot_response_200_agent_image_type_0 import (
            PostAgentsAgentIdSnapshotResponse200AgentImageType0,
        )

        d = dict(src_dict)
        id = d.pop("id")

        name = d.pop("name")

        type_ = PostAgentsAgentIdSnapshotResponse200AgentType(d.pop("type"))

        visibility = PostAgentsAgentIdSnapshotResponse200AgentVisibility(
            d.pop("visibility")
        )

        status = PostAgentsAgentIdSnapshotResponse200AgentStatus(d.pop("status"))

        def _parse_created_by(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        created_by = _parse_created_by(d.pop("createdBy"))

        def _parse_created_by_user(
            data: object,
        ) -> None | PostAgentsAgentIdSnapshotResponse200AgentCreatedByUserType0:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                created_by_user_type_0 = PostAgentsAgentIdSnapshotResponse200AgentCreatedByUserType0.from_dict(
                    data
                )

                return created_by_user_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(
                None | PostAgentsAgentIdSnapshotResponse200AgentCreatedByUserType0, data
            )

        created_by_user = _parse_created_by_user(d.pop("createdByUser"))

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

        def _parse_parent_agent_id(data: object) -> None | Unset | UUID:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                parent_agent_id_type_0 = UUID(data)

                return parent_agent_id_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | Unset | UUID, data)

        parent_agent_id = _parse_parent_agent_id(d.pop("parentAgentId", UNSET))

        def _parse_image_id(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        image_id = _parse_image_id(d.pop("imageId", UNSET))

        def _parse_image_variant_id(data: object) -> None | Unset | UUID:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                image_variant_id_type_0 = UUID(data)

                return image_variant_id_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | Unset | UUID, data)

        image_variant_id = _parse_image_variant_id(d.pop("imageVariantId", UNSET))

        def _parse_image(
            data: object,
        ) -> None | PostAgentsAgentIdSnapshotResponse200AgentImageType0 | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                image_type_0 = (
                    PostAgentsAgentIdSnapshotResponse200AgentImageType0.from_dict(data)
                )

                return image_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(
                None | PostAgentsAgentIdSnapshotResponse200AgentImageType0 | Unset, data
            )

        image = _parse_image(d.pop("image", UNSET))

        def _parse_current_sandbox_id(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        current_sandbox_id = _parse_current_sandbox_id(d.pop("currentSandboxId", UNSET))

        def _parse_sandbox_name(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        sandbox_name = _parse_sandbox_name(d.pop("sandboxName", UNSET))

        def _parse_snapshot_image_id(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        snapshot_image_id = _parse_snapshot_image_id(d.pop("snapshotImageId", UNSET))

        def _parse_region(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        region = _parse_region(d.pop("region", UNSET))

        post_agents_agent_id_snapshot_response_200_agent = cls(
            id=id,
            name=name,
            type_=type_,
            visibility=visibility,
            status=status,
            created_by=created_by,
            created_by_user=created_by_user,
            created_at=created_at,
            updated_at=updated_at,
            parent_agent_id=parent_agent_id,
            image_id=image_id,
            image_variant_id=image_variant_id,
            image=image,
            current_sandbox_id=current_sandbox_id,
            sandbox_name=sandbox_name,
            snapshot_image_id=snapshot_image_id,
            region=region,
        )

        post_agents_agent_id_snapshot_response_200_agent.additional_properties = d
        return post_agents_agent_id_snapshot_response_200_agent

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
