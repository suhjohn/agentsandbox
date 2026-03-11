from enum import Enum


class PostCoordinatorRunsRunIdCancelResponse200Status(str, Enum):
    ALREADY_CANCELED = "already_canceled"
    ALREADY_FINISHED = "already_finished"
    CANCELED = "canceled"

    def __str__(self) -> str:
        return str(self.value)
