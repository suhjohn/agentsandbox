from enum import Enum


class PostAgentsResponse201Status(str, Enum):
    ACTIVE = "active"
    ARCHIVED = "archived"
    COMPLETED = "completed"
    SNAPSHOTTING = "snapshotting"

    def __str__(self) -> str:
        return str(self.value)
