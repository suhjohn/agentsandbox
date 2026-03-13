from enum import Enum


class GetImagesImageIdVariantsResponse200DataItemScope(str, Enum):
    PERSONAL = "personal"
    SHARED = "shared"

    def __str__(self) -> str:
        return str(self.value)
