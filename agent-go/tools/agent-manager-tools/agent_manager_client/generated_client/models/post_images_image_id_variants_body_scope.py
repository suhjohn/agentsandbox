from enum import Enum


class PostImagesImageIdVariantsBodyScope(str, Enum):
    PERSONAL = "personal"
    SHARED = "shared"

    def __str__(self) -> str:
        return str(self.value)
