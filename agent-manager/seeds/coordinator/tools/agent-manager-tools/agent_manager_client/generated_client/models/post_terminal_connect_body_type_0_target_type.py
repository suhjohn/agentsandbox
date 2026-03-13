from enum import Enum


class PostTerminalConnectBodyType0TargetType(str, Enum):
    SETUPSANDBOX = "setupSandbox"

    def __str__(self) -> str:
        return str(self.value)
