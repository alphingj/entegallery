# Ente Gallery — Android Native Re-embedder (12GB RAM, max precision)

Kotlin + `onnxruntime-android:1.22.0` + `supabase-kt` — direct Supabase rewrite with the same `det_500m` (SCRFD 500M) + `glintr100` (250MB, antelopev2, 512d) models as `local-runner-py`. Runs fully offline after models are cached; 12GB RAM holds both sessions (~1.5GB). Most compatible + most accurate stack for Android (NNAPI + XNNPACK).

## Why Kotlin Native (not Capacitor/wrapper)

* Same ONNX files as `../public/models/insight/` — `glintr100.onnx` + `det_500m.onnx` via file-path `Session.create(modelPath)` not `ArrayBuffer` (avoids 2x RAM spike of `onnxruntime-web` wasm).
* `NNAPI` delegate uses DSP/GPU on Snapdragon/Exynos; `XNNPACK` fallback. `insight-client.ts:51` single-thread wasm would be 10x slower on phone.
* No `service_role` in APK — uses `anon` + RLS or Edge Function (see `android/SECURITY.md`).

## Setup

```bash
# 1. Android Studio Hedgehog+ with NDK
# Open android/ as project

# 2. Models — NOT bundled in APK (Play 150MB limit). App downloads on first launch to getFilesDir()/models/
# You can also push manually for dev:
adb push ../public/models/insight/glintr100.onnx /data/data/com.ente.gallery/files/models/
adb push ../public/models/insight/det_500m.onnx /data/data/com.ente.gallery/files/models/
# or:
bash ../scripts/download-models.sh   # then copy to device via Android Studio Device Explorer

# 3. Env — set in local.properties or BuildConfig:
# SUPABASE_URL, SUPABASE_ANON_KEY, GOOGLE_CLIENT_ID/SECRET/REFRESH_TOKEN/DRIVE_FOLDER_ID
# See android/local.properties.example

# 4. Build
./gradlew :app:assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

## How it works

Mirrors `local-runner-py/src/run.py` + `src/lib/face/insight-client.ts`:

1. `SupabaseRepo.kt` paginates `photos` (`face_scan_status=pending` or `all`), `GoogleDriveClient.kt` fetches `lh3.googleusercontent.com/d/{id}=w1600` fallback `alt=media` via `OkHttp` + OAuth `refresh_token` (same as `src/drive.py`).
2. `FaceEngine.kt` — `OrtEnvironment`, 2 sessions: `det_500m.onnx` (SCRFD 640) + `glintr100.onnx` (112x112). Preprocess `Preprocess.kt`: `resize MAX_INFER_DIM=1920` -> `scrfdPreprocess 640` -> `warpAffine` 5-point to `ARC_TEMPLATE [[38.29,51.69]...]` -> `CHW (x-127.5)/127.5` -> `L2`.
3. Batch `rpc(match_person_top2, {q, max_dist:0.28})` pre-photo snapshot (same as `face-matcher.ts:64`), `threshold 0.28 floor 0.20 margin 0.06` (tuned for glintr100).
4. `people` + `photo_faces` inserts (512d) + `photos.face_scan_status='done'` via `supabase-kt` postgrest.
5. `WorkManager` + foreground `FaceScanService` processes 25 per batch, respects `BatteryNotLow`, shows `Notification` progress. User can also trigger single `photoId` from gallery.

## Thresholds

`FaceEngine.kt` defaults `threshold=0.28 margin=0.06 floor=0.20` — same as `local-runner-py/src/config.py`. Change in `Settings` or `local.properties FACE_THRESHOLD`.

## Security

See `SECURITY.md` for RLS/Edge Function proxy — do NOT embed `SERVICE_ROLE_KEY` in `BuildConfig`.
