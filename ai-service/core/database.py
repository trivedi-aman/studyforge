from supabase import create_client, Client
from core.config import get_settings

_client: Client | None = None


def get_db() -> Client:
    """
    Service-role Supabase client — bypasses RLS.
    Cached as a module singleton to avoid reconnecting per request.
    """
    global _client
    if _client is None:
        s = get_settings()
        _client = create_client(s.supabase_url, s.supabase_service_role_key)
    return _client