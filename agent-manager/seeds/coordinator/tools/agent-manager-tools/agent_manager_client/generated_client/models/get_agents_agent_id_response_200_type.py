from enum import Enum


class GetAgentsAgentIdResponse200Type(str, Enum):
    COORDINATOR = "coordinator"
    WORKER = "worker"

    def __str__(self) -> str:
        return str(self.value)
