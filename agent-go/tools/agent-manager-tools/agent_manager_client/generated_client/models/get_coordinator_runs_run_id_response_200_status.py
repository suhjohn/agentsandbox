from enum import Enum


class GetCoordinatorRunsRunIdResponse200Status(str, Enum):
    CANCELED = "canceled"
    COMPLETED = "completed"
    ERROR = "error"
    RUNNING = "running"

    def __str__(self) -> str:
        return str(self.value)
