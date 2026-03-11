from enum import Enum


class PostAgentsAgentIdSnapshotResponse200AgentType(str, Enum):
    COORDINATOR = "coordinator"
    WORKER = "worker"

    def __str__(self) -> str:
        return str(self.value)
