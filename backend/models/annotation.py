from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class AnnotationCreate(BaseModel):
    document_id: str
    version_number: int
    annotation_type: str = "highlight"
    page_number: int
    x_coord: Optional[float] = None
    y_coord: Optional[float] = None
    width: Optional[float] = None
    height: Optional[float] = None
    content: Optional[str] = None
    color: str = "yellow"


class AnnotationOut(BaseModel):
    id: str
    document_id: str
    document_version_id: str
    user_id: str
    annotation_type: str
    page_number: int
    x_coord: Optional[float]
    y_coord: Optional[float]
    width: Optional[float]
    height: Optional[float]
    content: Optional[str]
    color: str
    created_at: datetime