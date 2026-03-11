from enum import Enum


class GetImagesResponse200DataItemVisibility(str, Enum):
    PRIVATE = "private"
    PUBLIC = "public"

    def __str__(self) -> str:
        return str(self.value)
