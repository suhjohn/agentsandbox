from enum import Enum


class PostImagesImageIdBuildResponse200VariantScope(str, Enum):
    PERSONAL = "personal"
    SHARED = "shared"

    def __str__(self) -> str:
        return str(self.value)
