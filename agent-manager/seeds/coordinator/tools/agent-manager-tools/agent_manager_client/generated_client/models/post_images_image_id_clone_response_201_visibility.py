from enum import Enum


class PostImagesImageIdCloneResponse201Visibility(str, Enum):
    PRIVATE = "private"
    PUBLIC = "public"

    def __str__(self) -> str:
        return str(self.value)
