from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from core.database import get_db
from core.config import get_settings

router = APIRouter(prefix="/auth", tags=["auth"])


class AuthRequest(BaseModel):
    email: str
    password: str


@router.post("/signup")
async def signup(body: AuthRequest):
    try:
        db = get_db()
        res = db.auth.sign_up({"email": body.email, "password": body.password})
        if res.user is None:
            raise HTTPException(status_code=400, detail="Signup failed")
        return {
            "user": {"id": res.user.id, "email": res.user.email, "name": body.email.split("@")[0]},
            "access_token": res.session.access_token if res.session else None,
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/login")
async def login(body: AuthRequest):
    try:
        db = get_db()
        res = db.auth.sign_in_with_password({"email": body.email, "password": body.password})
        if res.user is None:
            raise HTTPException(status_code=401, detail="Invalid credentials")
        return {
            "user": {"id": res.user.id, "email": res.user.email, "name": res.user.email.split("@")[0]},
            "access_token": res.session.access_token,
        }
    except Exception as e:
        raise HTTPException(status_code=401, detail=str(e))


@router.post("/logout")
async def logout():
    # JWT is stateless — client drops the token. Supabase handles refresh invalidation.
    return {"ok": True}