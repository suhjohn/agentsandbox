from enum import Enum


class GetSessionGroupsCreatedAtRange(str, Enum):
    ALL = "all"
    VALUE_1 = "24h"
    VALUE_2 = "7d"
    VALUE_3 = "30d"
    VALUE_4 = "90d"

    def __str__(self) -> str:
        return str(self.value)
