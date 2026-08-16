from pydantic import BaseModel
from typing import Optional


class TagCreate(BaseModel):
    name: str


class TagOut(BaseModel):
    id: str
    user_id: str
    name: str