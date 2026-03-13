from enum import Enum


class GetCoordinatorSessionCoordinatorSessionIdMessagesResponse200DataItemRole(
    str, Enum
):
    ASSISTANT = "assistant"
    TOOL = "tool"
    USER = "user"

    def __str__(self) -> str:
        return str(self.value)
