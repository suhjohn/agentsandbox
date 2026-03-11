from enum import Enum


class PostAgentsAgentIdSessionResponse200AgentStatus(str, Enum):
    ACTIVE = "active"
    ARCHIVED = "archived"
    COMPLETED = "completed"
    SNAPSHOTTING = "snapshotting"

    def __str__(self) -> str:
        return str(self.value)
