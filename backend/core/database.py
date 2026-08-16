from supabase import create_client, Client
from core.config import get_settings

_service_client: Client | None = None


def get_service_db() -> Client:
    """
    Service-role client — bypasses RLS.
    Cached as a module singleton so we don't create a new HTTP connection
    on every single request (which was causing 5-10s delays).
    """
    global _service_client
    if _service_client is None:
        s = get_settings()
        _service_client = create_client(s.supabase_url, s.supabase_service_role_key)
    return _service_client


def get_fresh_service_db() -> Client:
    """Non-cached client — only for auth operations that need a fresh session."""
    s = get_settings()
    return create_client(s.supabase_url, s.supabase_service_role_key)



get_db = get_service_db