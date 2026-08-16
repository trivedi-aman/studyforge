from fastapi import APIRouter, Depends, HTTPException
from core.auth import get_current_user
from core.database import get_service_db
from models.tag import TagCreate, TagOut

router = APIRouter(tags=["tags"])


@router.get("/tags")
async def list_tags(user=Depends(get_current_user)):
    db = get_service_db()
    res = db.table("tags").select("*").eq("user_id", user["user_id"]).execute()
    return res.data or []


@router.post("/tags", status_code=201)
async def create_tag(body: TagCreate, user=Depends(get_current_user)):
    db = get_service_db()
    res = db.table("tags").insert({"user_id": user["user_id"], "name": body.name}).execute()
    return res.data[0]


@router.post("/documents/{doc_id}/tags/{tag_id}")
async def attach_tag(doc_id: str, tag_id: str, user=Depends(get_current_user)):
    db = get_service_db()
    # Verify ownership of both
    doc = db.table("documents").select("id").eq("id", doc_id).eq("user_id", user["user_id"]).execute()
    tag = db.table("tags").select("id").eq("id", tag_id).eq("user_id", user["user_id"]).execute()
    if not doc.data or not tag.data:
        raise HTTPException(status_code=404, detail="Document or tag not found")
    db.table("document_tags").upsert({"document_id": doc_id, "tag_id": tag_id}).execute()
    return {"attached": True}


@router.delete("/documents/{doc_id}/tags/{tag_id}", status_code=204)
async def detach_tag(doc_id: str, tag_id: str, user=Depends(get_current_user)):
    db = get_service_db()
    db.table("document_tags").delete().eq("document_id", doc_id).eq("tag_id", tag_id).execute()
    return None