from enum import Enum


class GetAgentsGroupsBy(str, Enum):
    CREATEDBY = "createdBy"
    IMAGEID = "imageId"

    def __str__(self) -> str:
        return str(self.value)
