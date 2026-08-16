from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class FolderCreate(BaseModel):
    name: str
    parent_folder_id: Optional[str] = None


class FolderUpdate(BaseModel):
    name: Optional[str] = None
    parent_folder_id: Optional[str] = None


class FolderOut(BaseModel):
    id: str
    user_id: str
    name: str
    parent_folder_id: Optional[str]
    created_at: datetime
    updated_at: datetime