from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from core.config import get_settings
from core.auth import get_current_user
from routers import auth, folders, documents, annotations, tags, ai_proxy

app = FastAPI(
    title="Studyforge API",
    version="1.0.0",
    description="Main backend for Studyforge — folders, files, versioning, annotations.",
)

settings = get_settings()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_url, "http://localhost:5500", "http://127.0.0.1:5500"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(folders.router)
app.include_router(documents.router)
app.include_router(annotations.router)
app.include_router(tags.router)
app.include_router(ai_proxy.router)


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/debug/me")
async def debug_me(user=Depends(get_current_user)):
    return user