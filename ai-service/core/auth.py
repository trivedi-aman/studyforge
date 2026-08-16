from fastapi import Header, HTTPException, status
from core.config import get_settings


async def verify_service_key(x_ai_service_key: str | None = Header(None)):
    """
    Dependency that validates the X-AI-Service-Key header on every request.
    This service is only called by the main backend, never the frontend.
    """
    expected = get_settings().ai_service_api_key
    if not x_ai_service_key or x_ai_service_key != expected:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid X-AI-Service-Key header",
        )
    return True