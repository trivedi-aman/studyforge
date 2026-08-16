from fastapi import APIRouter, Depends, HTTPException, Query
from core.auth import get_current_user
from core.database import get_service_db
from models.annotation import AnnotationCreate, AnnotationOut

router = APIRouter(prefix="/documents", tags=["annotations"])


@router.get("/{doc_id}/annotations")
async def list_annotations(
    doc_id: str,
    version: int = Query(...),
    user=Depends(get_current_user),
):
    db = get_service_db()
    # Verify ownership
    doc = db.table("documents").select("id").eq("id", doc_id).eq("user_id", user["user_id"]).execute()
    if not doc.data:
        raise HTTPException(status_code=404, detail="Document not found")

    # Get the document_version id for this version number
    ver = db.table("document_versions").select("id").eq("document_id", doc_id).eq("version_number", version).execute()
    if not ver.data:
        return []  # No version yet = no annotations
    version_id = ver.data[0]["id"]

    res = db.table("annotations").select("*").eq("document_id", doc_id).eq("document_version_id", version_id).execute()
    return res.data or []


@router.post("/{doc_id}/annotations", status_code=201)
async def create_annotation(doc_id: str, body: AnnotationCreate, user=Depends(get_current_user)):
    db = get_service_db()
    doc = db.table("documents").select("id").eq("id", doc_id).eq("user_id", user["user_id"]).execute()
    if not doc.data:
        raise HTTPException(status_code=404, detail="Document not found")

    # Resolve version_id from version_number
    ver = db.table("document_versions").select("id").eq("document_id", doc_id).eq("version_number", body.version_number).execute()
    if not ver.data:
        raise HTTPException(status_code=404, detail="Version not found")
    version_id = ver.data[0]["id"]

    payload = {
        "document_id": doc_id,
        "document_version_id": version_id,
        "user_id": user["user_id"],
        "annotation_type": body.annotation_type,
        "page_number": body.page_number,
        "x_coord": body.x_coord,
        "y_coord": body.y_coord,
        "width": body.width,
        "height": body.height,
        "content": body.content,
        "color": body.color,
    }
    res = db.table("annotations").insert(payload).execute()
    return res.data[0]


@router.delete("/annotations/{annotation_id}", status_code=204)
async def delete_annotation(annotation_id: str, user=Depends(get_current_user)):
    db = get_service_db()
    existing = db.table("annotations").select("id, user_id").eq("id", annotation_id).execute()
    if not existing.data:
        raise HTTPException(status_code=404, detail="Annotation not found")
    if existing.data[0]["user_id"] != user["user_id"]:
        raise HTTPException(status_code=403, detail="Not your annotation")
    db.table("annotations").delete().eq("id", annotation_id).execute()
    return None