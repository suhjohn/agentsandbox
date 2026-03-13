from enum import Enum


class PostTerminalConnectResponse200TargetType(str, Enum):
    AGENTSANDBOX = "agentSandbox"
    SETUPSANDBOX = "setupSandbox"

    def __str__(self) -> str:
        return str(self.value)
