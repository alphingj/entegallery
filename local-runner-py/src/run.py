#!/usr/bin/env python3
"""
Kali Python re-embedder: direct Supabase + Drive, SCRFD 500M + glintr100 (250MB) max precision.

Mirrors browser pipeline:
  - Supabase photos paginated by created_at (or face_scan_status=pending)
  - Drive fetch lh3 w1600 -> alt=media fallback
  - FaceEngine detect+embed 512d L2
  - Batch rpc match_person_top2 pre-photo snapshot -> decide with threshold/margin/floor
  - Insert people + photo_faces + update photos.face_scan_status=done

Usage:
  python -m src.run --all --concurrency 2 --threshold 0.28 --margin 0.06
  python -m src.run --photo-id <uuid> --verbose --dry-run
  python -m src.run --all --limit 100
"""
import argparse
import io
import sys
import time
import traceback
from pathlib import Path
from typing import List

from .config import FACE_THRESHOLD, FACE_MARGIN, FACE_FLOOR, MODELS_DIR
from .match import decide_match
from .supabase_client import get_supabase
from .drive import fetch_image_bytes

# Lazy imports — allow --help without cv2/numpy installed
try:
    import cv2  # type: ignore
    HAS_CV2 = True
except Exception:
    cv2 = None  # type: ignore
    HAS_CV2 = False

try:
    import numpy as np  # type: ignore
    HAS_NP = True
except Exception:
    np = None  # type: ignore
    HAS_NP = False

try:
    from tqdm import tqdm  # type: ignore
except Exception:
    def tqdm(iterable=None, *a, **kw):  # fallback no-op
        return iterable if iterable is not None else []
    tqdm = tqdm  # type: ignore

try:
    from PIL import Image  # type: ignore
except Exception:
    Image = None  # type: ignore

def load_image_bytes(data: bytes):
    if not HAS_CV2 or not HAS_NP:
        raise RuntimeError("opencv-python-headless and numpy required. Run: pip install -e .  (or pip install opencv-python-headless numpy) inside local-runner-py/.venv")
    assert cv2 is not None and np is not None
    # Try cv2.imdecode first (faster), fallback PIL
    nparr = np.frombuffer(data, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img is not None and img.size > 0:
        return img
    if Image is None:
        raise RuntimeError("Pillow required for fallback decode")
    # PIL fallback
    pil = Image.open(io.BytesIO(data)).convert("RGB")
    img = cv2.cvtColor(np.array(pil), cv2.COLOR_RGB2BGR)
    return img

def fetch_photos_batch(sb, limit=25, cursor=None, all_mode=False):
    # Both modes now filter pending — the difference is cursor pagination vs head.
    # --all uses created_at cursor for stable full-scan after wipe; pending mode just takes head 25.
    # This avoids reprocessing HEIC that were just marked unsupported (oldest rows).
    if all_mode:
        q = sb.table("photos").select("id,google_drive_file_id,file_name,width,height,mime_type,face_scan_status,created_at").eq("face_scan_status", "pending").order("created_at", desc=False).limit(limit)
        if cursor:
            q = q.gt("created_at", cursor)
        res = q.execute()
        return res.data or []
    else:
        res = sb.table("photos").select("id,google_drive_file_id,file_name,width,height,mime_type,created_at").eq("face_scan_status", "pending").order("created_at", desc=False).limit(limit).execute()
        return res.data or []

def is_heic(mime, name):
    return (mime or "").lower() in ("image/heic","image/heif") or (name or "").lower().endswith((".heic",".heif"))

def process_one(photo, engine, sb, args):
    pid = photo["id"]
    fid = photo["google_drive_file_id"]
    fname = photo.get("file_name") or pid

    if is_heic(photo.get("mime_type"), photo.get("file_name")):
        if not args.dry_run:
            sb.table("photos").update({"face_scan_status": "unsupported"}).eq("id", pid).execute()
        return {"photo": fname, "faces": 0, "unsupported": True, "diagnostics": []}

    # fetch bytes
    try:
        data = fetch_image_bytes(fid)
    except Exception as e:
        print(f"[skip] {fname} fetch failed: {e}")
        return {"photo": fname, "faces": 0, "error": str(e), "diagnostics": []}

    # decode
    try:
        img = load_image_bytes(data)
        if img is None or img.size == 0:
            raise RuntimeError("decode failed")
        h0,w0 = img.shape[:2]
    except Exception as e:
        print(f"[skip] {fname} decode failed: {e}")
        return {"photo": fname, "faces": 0, "error": str(e), "diagnostics": []}

    # detect
    try:
        faces = engine.detect_and_embed(img)
    except Exception as e:
        traceback.print_exc()
        print(f"[error] detect failed {fname}: {e}")
        return {"photo": fname, "faces": 0, "error": str(e), "diagnostics": []}

    if not faces:
        if not args.dry_run:
            # still mark done, update dimensions if missing
            upd = {"face_scan_status": "done"}
            if not photo.get("width"):
                upd["width"] = w0
                upd["height"] = h0
            sb.table("photos").update(upd).eq("id", pid).execute()
        return {"photo": fname, "faces": 0, "diagnostics": []}

    # batch match against pre-photo snapshot
    diagnostics = []
    candidate_lists = []
    for f in faces:
        if f.embedding is None or len(f.embedding)!=512:
            candidate_lists.append([])
            continue
        try:
            # Ensure Python floats for pgvector JSON (numpy float32 is not JSON serializable)
            if hasattr(f.embedding, 'tolist'):
                q = [float(x) for x in f.embedding.tolist()]
            else:
                q = [float(x) for x in list(f.embedding)]
            resp = sb.rpc("match_person_top2", {"q": q, "max_dist": float(args.threshold)}).execute()
            data = resp.data or []
            candidate_lists.append(data)
        except Exception as e:
            print(f"[warn] rpc failed {fname} face: {e}")
            candidate_lists.append([])

    # Write phase: decide and insert
    if args.dry_run:
        for i, cands in enumerate(candidate_lists):
            best = decide_match(cands, args.threshold, args.margin, args.floor)
            diagnostics.append({"index": i, "matched": best is not None, "name": best["name"] if best else "Unknown (new)", "bestDistance": cands[0]["distance"] if cands else None, "secondDistance": cands[1]["distance"] if len(cands)>1 else None})
            if args.verbose:
                print(f"  face {i}: {diagnostics[-1]}")
        return {"photo": fname, "faces": len(faces), "diagnostics": diagnostics}

    # Real write: for each face, decide then insert person if needed, then photo_faces
    for i, f in enumerate(faces):
        cands = candidate_lists[i]
        best = decide_match(cands, args.threshold, args.margin, args.floor)
        diagnostics.append({"index": i, "matched": best is not None, "name": best["name"] if best else "Unknown", "bestDistance": cands[0]["distance"] if cands else None, "secondDistance": cands[1]["distance"] if len(cands)>1 else None})
        if args.verbose:
            print(f"  face {i}: {'MATCH '+best['name'] if best else 'NEW Unknown'} best={cands[0]['distance'] if cands else None} second={cands[1]['distance'] if len(cands)>1 else None}")

        if best:
            person_id = best["person_id"]
            name = best["name"]
        else:
            # create new Unknown person with this embedding — ensure Python floats
            try:
                if hasattr(f.embedding, 'tolist'):
                    desc = [float(x) for x in f.embedding.tolist()]
                else:
                    desc = [float(x) for x in list(f.embedding)]
                ins = sb.table("people").insert({"name": "Unknown", "descriptor": desc}).execute()
                person_id = ins.data[0]["id"]
                name = ins.data[0]["name"]
            except Exception as e:
                print(f"[error] person insert failed {fname} face {i}: {e}")
                continue

        # insert photo_faces — ensure box_norm and descriptor are pure Python floats
        try:
            if hasattr(f.embedding, 'tolist'):
                desc2 = [float(x) for x in f.embedding.tolist()]
            else:
                desc2 = [float(x) for x in list(f.embedding)]
            box = {k: float(v) for k, v in f.box_norm.items()} if isinstance(f.box_norm, dict) else f.box_norm
            sb.table("photo_faces").insert({
                "photo_id": pid,
                "person_id": person_id,
                "bounding_box": box,
                "descriptor": desc2
            }).execute()
        except Exception as e:
            print(f"[error] photo_faces insert failed {fname} face {i}: {e}")

    # update photo dimensions + done
    try:
        upd = {"face_scan_status": "done"}
        if not photo.get("width"):
            upd["width"] = w0
            upd["height"] = h0
        sb.table("photos").update(upd).eq("id", pid).execute()
    except Exception as e:
        print(f"[warn] update photo done failed {fname}: {e}")

    return {"photo": fname, "faces": len(faces), "diagnostics": diagnostics}

def main():
    ap = argparse.ArgumentParser(description="Ente local runner — Kali Python max-precision re-embedder")
    ap.add_argument("--all", action="store_true", help="process all photos (ignore face_scan_status), paginate by created_at")
    ap.add_argument("--limit", type=int, default=None, help="max photos this run")
    ap.add_argument("--photo-id", type=str, help="process single photo by id")
    ap.add_argument("--concurrency", type=int, default=2, help="photos per batch (currently serial, 1..6)")
    ap.add_argument("--threshold", type=float, default=FACE_THRESHOLD, help="cosine distance cutoff (default 0.28 for glintr100)")
    ap.add_argument("--margin", type=float, default=FACE_MARGIN, help="second-best margin (default 0.06)")
    ap.add_argument("--floor", type=float, default=FACE_FLOOR, help="auto-trust floor (default 0.20)")
    ap.add_argument("--models-dir", type=str, default=str(MODELS_DIR), help="path to insight models dir")
    ap.add_argument("--provider", choices=["cpu","rocm"], default="cpu", help="onnx provider")
    ap.add_argument("--dry-run", action="store_true", help="detect only, no DB writes")
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()

    concurrency = max(1, min(args.concurrency, 6))

    # Early check for --help already handled by argparse; verify heavy deps for actual run
    if not HAS_CV2 or not HAS_NP:
        print("ERROR: Missing heavy deps (opencv, numpy).")
        print("  cd local-runner-py && python3 -m venv .venv && source .venv/bin/activate")
        print("  pip install -U pip && pip install -e . && pip install insightface")
        sys.exit(1)
    if Image is None:
        print("ERROR: Pillow missing. pip install Pillow")
        sys.exit(1)

    try:
        sb = get_supabase()
    except Exception as e:
        print(f"[fatal] Supabase config failed: {e}")
        print("  Ensure ../.env.local has SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see README.md)")
        sys.exit(1)
    # engine
    print(f"Loading face engine models_dir={args.models_dir} provider={args.provider} threshold={args.threshold} margin={args.margin} floor={args.floor}")
    from .face.engine import FaceEngine
    try:
        engine = FaceEngine(models_dir=Path(args.models_dir), provider=args.provider, verbose=args.verbose)
        print(f"Engine backend={engine.backend}")
    except Exception as e:
        print(f"[fatal] face engine load failed: {e}")
        traceback.print_exc()
        sys.exit(1)

    # single photo mode
    if args.photo_id:
        photo = sb.table("photos").select("id,google_drive_file_id,file_name,width,height,mime_type,created_at").eq("id", args.photo_id).maybe_single().execute()
        if not photo.data:
            print(f"photo {args.photo_id} not found")
            sys.exit(1)
        res = process_one(photo.data, engine, sb, args)
        print(res)
        return

    # batch mode
    total = 0
    cursor = None
    bar = None
    if args.limit:
        bar = tqdm(total=args.limit, desc="photos", unit="photo")

    while True:
        if args.limit is not None and total >= args.limit:
            break
        remaining = args.limit - total if args.limit else 25
        batch_size = min(25, remaining) if args.limit else 25
        batch = fetch_photos_batch(sb, limit=batch_size, cursor=cursor, all_mode=args.all)
        if not batch:
            print("No more photos.")
            break

        # For --all mode, cursor is max created_at; for pending mode, we just keep fetching pending (no cursor)
        if args.all:
            # ensure sorted
            batch = sorted(batch, key=lambda x: x["created_at"])

        for photo in batch:
            if args.limit is not None and total >= args.limit:
                break
            if args.verbose:
                print(f"\n[{total+1}] {photo.get('file_name')} {photo['id']} status={photo.get('face_scan_status')}")
            try:
                res = process_one(photo, engine, sb, args)
                if args.verbose:
                    print(f" -> faces={res.get('faces')} diagnostics={res.get('diagnostics')}")
            except Exception as e:
                print(f"[error] photo {photo['id']} failed: {e}")
                traceback.print_exc()
            total += 1
            if bar:
                bar.update(1)
                bar.set_postfix_str(f"last={photo.get('file_name','')[:20]}")
            if args.all:
                cursor = photo["created_at"]
            # small sleep to avoid hammering Supabase
            time.sleep(0.05)

        if not args.all:
            # pending mode: if we got less than batch_size, we are done
            if len(batch) < batch_size:
                break
            # else continue fetching next pending batch
        else:
            if len(batch) < batch_size:
                break

    if bar:
        bar.close()
    print(f"Done. Processed {total} photos. {'DRY-RUN — no writes' if args.dry_run else 'DB updated.'}")

if __name__ == "__main__":
    main()
