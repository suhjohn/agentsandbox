from enum import Enum


class GetAgentsGroupsVisibility(str, Enum):
    PRIVATE = "private"
    SHARED = "shared"

    def __str__(self) -> str:
        return str(self.value)
