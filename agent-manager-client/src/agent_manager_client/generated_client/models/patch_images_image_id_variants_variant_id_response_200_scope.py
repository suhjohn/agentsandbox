from enum import Enum


class PatchImagesImageIdVariantsVariantIdResponse200Scope(str, Enum):
    PERSONAL = "personal"
    SHARED = "shared"

    def __str__(self) -> str:
        return str(self.value)
