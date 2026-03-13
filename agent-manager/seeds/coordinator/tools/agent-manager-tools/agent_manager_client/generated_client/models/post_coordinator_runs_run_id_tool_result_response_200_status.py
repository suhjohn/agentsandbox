from enum import Enum


class PostCoordinatorRunsRunIdToolResultResponse200Status(str, Enum):
    ACCEPTED = "accepted"
    ALREADY_RESOLVED = "already_resolved"

    def __str__(self) -> str:
        return str(self.value)
