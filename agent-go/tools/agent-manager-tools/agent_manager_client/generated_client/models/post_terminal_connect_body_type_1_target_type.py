from enum import Enum


class PostTerminalConnectBodyType1TargetType(str, Enum):
    AGENTSANDBOX = "agentSandbox"

    def __str__(self) -> str:
        return str(self.value)
