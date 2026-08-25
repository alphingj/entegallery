import os
from pathlib import Path
from dotenv import load_dotenv

# Resolve repo root (ente-gallery/) from local-runner-py/src/config.py
REPO_ROOT = Path(__file__).resolve().parents[2]
RUNNER_ROOT = Path(__file__).resolve().parents[1]

# Load env: local-runner-py/.env.local -> ../.env.local -> ../.env -> env.example
for p in [
    RUNNER_ROOT / ".env.local",
    REPO_ROOT / ".env.local",
    RUNNER_ROOT / ".env",
    REPO_ROOT / ".env",
]:
    if p.exists():
        load_dotenv(p, override=False)

def require_env(name: str) -> str:
    v = os.getenv(name)
    if not v:
        raise RuntimeError(f"Missing env {name} — set in {REPO_ROOT}/.env.local (see .env.example)")
    return v

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")
GOOGLE_REFRESH_TOKEN = os.getenv("GOOGLE_REFRESH_TOKEN", "")
GOOGLE_DRIVE_FOLDER_ID = os.getenv("GOOGLE_DRIVE_FOLDER_ID", "")

# Face thresholds — glintr100 tighter than w600k_mbf (0.30). Calibrate on your data 0.28-0.32.
FACE_THRESHOLD = float(os.getenv("FACE_MATCH_THRESHOLD") or os.getenv("NEXT_PUBLIC_FACE_MATCH_THRESHOLD") or "0.28")
FACE_MARGIN = float(os.getenv("FACE_MATCH_MARGIN") or os.getenv("NEXT_PUBLIC_FACE_MATCH_MARGIN") or "0.06")
FACE_FLOOR = float(os.getenv("FACE_AUTO_FLOOR") or "0.20")

# Models — shared with Next.js public/models/insight/
DEFAULT_MODELS_DIR = REPO_ROOT / "public" / "models" / "insight"
MODELS_DIR = Path(os.getenv("MODELS_DIR") or str(DEFAULT_MODELS_DIR))
DET_MODEL = MODELS_DIR / "det_500m.onnx"
RECOG_MODEL_GLINT = MODELS_DIR / "glintr100.onnx"
RECOG_MODEL_FALLBACK = MODELS_DIR / "w600k_mbf.onnx"

MAX_INFER_DIM = 1920

# ArcFace alignment template 112x112 (InsightFace standard)
ARC_TEMPLATE = [
    [38.2946, 51.6963],
    [73.5318, 51.5014],
    [56.0252, 71.7366],
    [41.5493, 92.3655],
    [70.7299, 92.2041],
]
