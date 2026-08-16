from fastapi import APIRouter, Depends, HTTPException
from core.auth import get_current_user
from core.config import get_settings
import httpx

router = APIRouter(prefix="/ai", tags=["ai"])


def ai_headers():
    return {"X-AI-Service-Key": get_settings().ai_service_api_key}


async def _forward(method: str, path: str, body: dict = None):
    base = get_settings().ai_service_base_url
    url = f"{base}{path}"
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            if method == "GET":
                r = await client.get(url, headers=ai_headers())
            else:
                r = await client.post(url, json=body, headers=ai_headers())
        if r.status_code >= 400:
            raise HTTPException(status_code=r.status_code, detail=r.text)
        return r.json()
    except httpx.ConnectError:
        raise HTTPException(
            status_code=503,
            detail="AI service is not running yet. This feature will be available once the AI microservice is deployed.",
        )
    except httpx.TimeoutException:
        raise HTTPException(
            status_code=504,
            detail="AI service timed out.",
        )


@router.post("/embed-document")
async def embed_document(body: dict, user=Depends(get_current_user)):
    return await _forward("POST", "/embed-document", body)


@router.post("/chat")
async def chat(body: dict, user=Depends(get_current_user)):
    return await _forward("POST", "/chat", body)


@router.post("/summarize")
async def summarize(body: dict, user=Depends(get_current_user)):
    return await _forward("POST", "/summarize", body)


@router.post("/explain")
async def explain(body: dict, user=Depends(get_current_user)):
    return await _forward("POST", "/explain", body)


@router.post("/jobs/youtube-to-notes")
async def youtube_to_notes(body: dict, user=Depends(get_current_user)):
    body["user_id"] = user["user_id"]
    return await _forward("POST", "/jobs/youtube-to-notes", body)


@router.post("/jobs/text-to-ppt")
async def text_to_ppt(body: dict, user=Depends(get_current_user)):
    body["user_id"] = user["user_id"]
    return await _forward("POST", "/jobs/text-to-ppt", body)


@router.post("/jobs/ppt-to-notes")
async def ppt_to_notes(body: dict, user=Depends(get_current_user)):
    body["user_id"] = user["user_id"]
    return await _forward("POST", "/jobs/ppt-to-notes", body)


@router.get("/jobs/{job_id}")
async def job_status(job_id: str, user=Depends(get_current_user)):
    return await _forward("GET", f"/jobs/{job_id}")