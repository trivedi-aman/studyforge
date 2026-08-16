from pydantic import BaseModel
from typing import Optional, Any
from datetime import datetime


class DocumentOut(BaseModel):
    id: str
    user_id: str
    folder_id: Optional[str]
    filename: str
    file_type: str
    original_s3_key: str
    preview_pdf_s3_key: Optional[str]
    is_ai_generated: bool
    source_type: str
    current_version: int
    display_metadata: dict
    file_size_bytes: Optional[int]
    created_at: datetime
    updated_at: datetime
    favorite: bool = False
    tags: list[str] = []


class DocumentUpdate(BaseModel):
    filename: Optional[str] = None
    folder_id: Optional[str] = None


class VersionOut(BaseModel):
    id: str
    document_id: str
    version_number: int
    s3_key: str
    file_size_bytes: Optional[int]
    uploaded_by: str
    uploaded_at: datetime