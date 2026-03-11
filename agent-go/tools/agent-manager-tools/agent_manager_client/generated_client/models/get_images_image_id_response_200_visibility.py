from enum import Enum


class GetImagesImageIdResponse200Visibility(str, Enum):
    PRIVATE = "private"
    PUBLIC = "public"

    def __str__(self) -> str:
        return str(self.value)
