from enum import Enum


class GetAgentsGroupsResponse200DataItemPreviewItemType(str, Enum):
    COORDINATOR = "coordinator"
    WORKER = "worker"

    def __str__(self) -> str:
        return str(self.value)
