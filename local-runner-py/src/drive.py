import time
import requests
from typing import Optional

from .config import GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN

TOKEN_URL = "https://oauth2.googleapis.com/token"
DRIVE_API = "https://www.googleapis.com/drive/v3"

_cached_token: dict | None = None

def get_access_token() -> str:
    global _cached_token
    if _cached_token and _cached_token["expires_at"] > time.time() + 60:
        return _cached_token["token"]
    if not (GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET and GOOGLE_REFRESH_TOKEN):
        raise RuntimeError("GOOGLE_CLIENT_ID/SECRET/REFRESH_TOKEN missing in .env.local")
    r = requests.post(TOKEN_URL, data={
        "client_id": GOOGLE_CLIENT_ID,
        "client_secret": GOOGLE_CLIENT_SECRET,
        "refresh_token": GOOGLE_REFRESH_TOKEN,
        "grant_type": "refresh_token",
    }, timeout=30)
    if not r.ok:
        raise RuntimeError(f"Google token refresh failed ({r.status_code}): {r.text[:500]}")
    j = r.json()
    _cached_token = {"token": j["access_token"], "expires_at": time.time() + j["expires_in"]}
    return _cached_token["token"]

def get_file_bytes(file_id: str, timeout=60) -> bytes:
    """Fetch raw bytes via Drive API alt=media with lh3 fallback."""
    token = get_access_token()
    # Try lh3 CDN first (no auth, fast, thumbnail-ish but w1600 is enough for detection)
    # Caller should try this before Drive API for speed; we support both.
    # Here we provide Drive API path; runner will try lh3 first then this.
    r = requests.get(
        f"{DRIVE_API}/files/{file_id}?alt=media&supportsAllDrives=true",
        headers={"Authorization": f"Bearer {token}"},
        timeout=timeout,
        stream=False,
    )
    if r.status_code == 200:
        return r.content
    raise RuntimeError(f"Drive media fetch failed ({r.status_code}) for {file_id}: {r.text[:300]}")

def fetch_via_lh3(file_id: str, timeout=30) -> Optional[bytes]:
    try:
        r = requests.get(f"https://lh3.googleusercontent.com/d/{file_id}=w1600", timeout=timeout)
        if r.ok and r.headers.get("content-type","").startswith("image/"):
            return r.content
        # some responses are redirects to image
        if r.ok and len(r.content) > 10000:
            return r.content
    except Exception:
        pass
    return None

def fetch_image_bytes(file_id: str) -> bytes:
    b = fetch_via_lh3(file_id)
    if b:
        return b
    return get_file_bytes(file_id)

def get_file_meta(file_id: str) -> dict:
    token = get_access_token()
    r = requests.get(
        f"{DRIVE_API}/files/{file_id}?fields=id,name,mimeType,size,imageMediaMetadata,md5Checksum,createdTime&supportsAllDrives=true",
        headers={"Authorization": f"Bearer {token}"},
        timeout=30,
    )
    if not r.ok:
        raise RuntimeError(f"Drive meta failed ({r.status_code}) for {file_id}")
    return r.json()
