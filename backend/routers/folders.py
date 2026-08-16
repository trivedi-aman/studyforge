from fastapi import APIRouter, Depends, HTTPException
from core.auth import get_current_user
from core.database import get_service_db
from models.folder import FolderCreate, FolderUpdate, FolderOut

router = APIRouter(prefix="/folders", tags=["folders"])


@router.get("")
async def list_folders(user=Depends(get_current_user)):
    db = get_service_db()
    res = db.table("folders").select("*").eq("user_id", user["user_id"]).execute()
    return res.data


@router.post("", status_code=201)
async def create_folder(body: FolderCreate, user=Depends(get_current_user)):
    db = get_service_db()
    payload = {
        "user_id": user["user_id"],
        "name": body.name,
        "parent_folder_id": body.parent_folder_id,
    }
    res = db.table("folders").insert(payload).execute()
    if not res.data:
        raise HTTPException(status_code=500, detail="Failed to create folder")
    return res.data[0]


@router.patch("/{folder_id}")
async def update_folder(folder_id: str, body: FolderUpdate, user=Depends(get_current_user)):
    db = get_service_db()
    # Verify ownership
    existing = db.table("folders").select("id").eq("id", folder_id).eq("user_id", user["user_id"]).execute()
    if not existing.data:
        raise HTTPException(status_code=404, detail="Folder not found")

    patch = {k: v for k, v in body.model_dump().items() if v is not None}
    if not patch:
        raise HTTPException(status_code=400, detail="Nothing to update")

    res = db.table("folders").update(patch).eq("id", folder_id).execute()
    return res.data[0]


@router.delete("/{folder_id}", status_code=204)
async def delete_folder(folder_id: str, user=Depends(get_current_user)):
    db = get_service_db()
    existing = db.table("folders").select("id").eq("id", folder_id).eq("user_id", user["user_id"]).execute()
    if not existing.data:
        raise HTTPException(status_code=404, detail="Folder not found")
    # CASCADE on DB handles children + documents SET NULL
    db.table("folders").delete().eq("id", folder_id).execute()
    return None