from enum import Enum


class PostImagesImageIdVariantsResponse201Scope(str, Enum):
    PERSONAL = "personal"
    SHARED = "shared"

    def __str__(self) -> str:
        return str(self.value)
