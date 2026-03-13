from enum import Enum


class GetAgentsGroupsResponse200DataItemPreviewItemVisibility(str, Enum):
    PRIVATE = "private"
    SHARED = "shared"

    def __str__(self) -> str:
        return str(self.value)
