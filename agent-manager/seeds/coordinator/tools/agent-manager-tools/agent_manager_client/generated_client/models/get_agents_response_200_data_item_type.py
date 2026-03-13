from enum import Enum


class GetAgentsResponse200DataItemType(str, Enum):
    COORDINATOR = "coordinator"
    WORKER = "worker"

    def __str__(self) -> str:
        return str(self.value)
