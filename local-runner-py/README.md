# Ente Local Runner — Python (Kali AMD Radeon, max precision)

Direct Supabase + Google Drive re-embedder. Wipes `people`/`photo_faces` and reprocesses **every** photo with `det_500m` (SCRFD 500M, 205MB) + `glintr100` (ResNet100, 250MB, antelopev2) — 512d ArcFace. Runs on **CPU** (`CPUExecutionProvider`) — stable on Kali AMD; ROCm is opt-in.

Maps 1:1 to the browser pipeline `src/lib/face/insight-client.ts` + `src/lib/face-matcher.ts:49` + `src/lib/cosine.ts` but with 5-point similarity warp (not squarify) and SOTA models.

## Quick start (Kali)

```bash
cd local-runner-py
python3 -m venv .venv && source .venv/bin/activate
pip install -U pip
pip install -e .                    # base
pip install insightface             # optional but recommended (one-liner antelopev2)
# or: pip install -e .[insight]

# 1. models — shares public/models/insight/ with the Next.js app
bash ../scripts/download-models.sh        # gets w600k_mbf (13MB) + glintr100 (250MB) + det_500m (205MB)
ls -lh ../public/models/insight/
# symlink so python sees the same files:
ln -sf ../public/models/insight models/insight  # or copy

# 2. env — reuses the Next.js .env.local
ln -sf ../.env.local .env.local
# needs: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GOOGLE_CLIENT_ID/SECRET/REFRESH_TOKEN, GOOGLE_DRIVE_FOLDER_ID

# 3. wipe + re-embed (full)
python -m src.wipe --yes                # TRUNCATE people, photo_faces, verification_tasks; photos -> pending
python -m src.run --all --concurrency 2 --threshold 0.28 --margin 0.06

# resume / dry-run / limit
python -m src.run --all --limit 100 --dry-run
python -m src.run --all --concurrency 4   # if you have 16GB+ and ROCm docker

# single photo debug
python -m src.run --photo-id <uuid> --verbose
```

## Options

```
run.py:
  --all                 reprocess every photo (ignores face_scan_status, paginates by created_at)
  --limit N             max photos this run (resume-friendly)
  --concurrency N       parallel faces per photo? currently per-photo serial, photos batched (default 2, max 6)
  --threshold F         cosine distance cutoff (default 0.28 for glintr100, was 0.30 for w600k_mbf)
  --margin F            second-best margin (default 0.06)
  --floor F             auto-trust floor (default 0.20, bypasses margin)
  --models-dir PATH     default ../public/models/insight
  --provider cpu|rocm   onnx provider (default cpu, rocm needs onnxruntime-rocm)
  --dry-run             detect only, no DB writes
  --verbose             log per-face distances
wipe.py:
  --yes                 skip confirmation
  --keep-people         only reset photos face_scan_status, don't truncate people/photo_faces
```

## How it works

1. **Supabase** `src/supabase_client.py` — `create_client(SUPABASE_URL, SERVICE_ROLE_KEY)` same as `src/lib/supabase.ts:6`.
2. **Drive** `src/drive.py` — OAuth `refresh_token` → `access_token` `https://oauth2.googleapis.com/token` (cached 55min) + `listFolderImages` `pageSize 1000` + `alt=media` download; fallback `lh3.googleusercontent.com/d/{id}=w1600`.
3. **Face** `src/face/engine.py` — tries `insightface.app.FaceAnalysis(name='antelopev2', providers=['CPUExecutionProvider'])` first; fallback manual `onnxruntime.InferenceSession(det_500m.onnx, glintr100.onnx)` with 5-point warp `src/face/preprocess.py` (template `[[38.29,51.69],[73.53,51.50],[56.02,71.73],[41.54,92.36],[70.72,92.20]]`).
4. **Match** `src/match.py` — batch `rpc('match_person_top2', {q, max_dist})` pre-photo snapshot, same as `face-matcher.ts:64`, then `meanDescriptor` L2 per `cosine.ts:31`.
5. **Write** — `people` + `photo_faces` (512d) + `photos.face_scan_status='done'` per `src/app/api/photos/[id]/faces/backfill/route.ts:64`.

## Android mirror

`../android/` uses the same two ONNX files via `onnxruntime-android` + `NNAPI` + `XNNPACK`, same 112x112 `(p-127.5)/127.5` `src/face/preprocess.py` template, same thresholds. See `android/README.md`.

## AMD notes

* Default `CPUExecutionProvider` stable on Kali Ryzen 7520U (8 threads, 7GB RAM). Set `OMP_NUM_THREADS=4` if swapping.
* ROCm: `pip install onnxruntime-rocm` + `provider=rocm` + Docker `rocm/pytorch:rocm6.2` only if `rocminfo` works.
