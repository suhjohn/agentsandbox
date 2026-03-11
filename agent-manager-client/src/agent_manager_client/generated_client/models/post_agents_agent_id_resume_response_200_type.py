from enum import Enum


class PostAgentsAgentIdResumeResponse200Type(str, Enum):
    COORDINATOR = "coordinator"
    WORKER = "worker"

    def __str__(self) -> str:
        return str(self.value)
