from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.post_images_image_id_build_response_200_image import (
        PostImagesImageIdBuildResponse200Image,
    )
    from ..models.post_images_image_id_build_response_200_variant import (
        PostImagesImageIdBuildResponse200Variant,
    )


T = TypeVar("T", bound="PostImagesImageIdBuildResponse200")


@_attrs_define
class PostImagesImageIdBuildResponse200:
    """
    Attributes:
        image (PostImagesImageIdBuildResponse200Image):
        variant (PostImagesImageIdBuildResponse200Variant):
    """

    image: PostImagesImageIdBuildResponse200Image
    variant: PostImagesImageIdBuildResponse200Variant
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        image = self.image.to_dict()

        variant = self.variant.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "image": image,
                "variant": variant,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_images_image_id_build_response_200_image import (
            PostImagesImageIdBuildResponse200Image,
        )
        from ..models.post_images_image_id_build_response_200_variant import (
            PostImagesImageIdBuildResponse200Variant,
        )

        d = dict(src_dict)
        image = PostImagesImageIdBuildResponse200Image.from_dict(d.pop("image"))

        variant = PostImagesImageIdBuildResponse200Variant.from_dict(d.pop("variant"))

        post_images_image_id_build_response_200 = cls(
            image=image,
            variant=variant,
        )

        post_images_image_id_build_response_200.additional_properties = d
        return post_images_image_id_build_response_200

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
