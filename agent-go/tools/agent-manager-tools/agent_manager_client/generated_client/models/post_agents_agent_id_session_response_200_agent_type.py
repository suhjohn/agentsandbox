from enum import Enum


class PostAgentsAgentIdSessionResponse200AgentType(str, Enum):
    COORDINATOR = "coordinator"
    WORKER = "worker"

    def __str__(self) -> str:
        return str(self.value)
