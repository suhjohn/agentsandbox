from enum import Enum


class GetSessionGroupsBy(str, Enum):
    CREATEDBY = "createdBy"
    IMAGEID = "imageId"
    STATUS = "status"

    def __str__(self) -> str:
        return str(self.value)
