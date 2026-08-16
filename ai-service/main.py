from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import embed, chat, jobs

app = FastAPI(
    title="Studyforge AI Service",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(embed.router)
app.include_router(chat.router)
app.include_router(jobs.router)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "studyforge-ai"}