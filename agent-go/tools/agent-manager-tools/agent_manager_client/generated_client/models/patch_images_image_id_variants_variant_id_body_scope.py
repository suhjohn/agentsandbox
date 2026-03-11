from enum import Enum


class PatchImagesImageIdVariantsVariantIdBodyScope(str, Enum):
    PERSONAL = "personal"
    SHARED = "shared"

    def __str__(self) -> str:
        return str(self.value)
