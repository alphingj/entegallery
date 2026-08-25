from supabase import create_client, Client
from .config import SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

_client: Client | None = None

def get_supabase() -> Client:
    global _client
    if _client is not None:
        return _client
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local")
    # supabase-py 2.x ClientOptions changed — try simplest form first, fallback with dict
    try:
        _client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    except Exception:
        try:
            from supabase.lib.client_options import ClientOptions
            _client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, options=ClientOptions(postgrest_client_timeout=30))
        except Exception:
            _client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, options={"auth": {"persistSession": False}})  # type: ignore
    return _client
