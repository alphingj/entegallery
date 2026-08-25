#!/usr/bin/env bash
# Downloads @vladmandic/face-api model weights into public/models/
# Format (vladmandic fork): <model>-weights_manifest.json + <model>.bin
set -euo pipefail

BASE_URL="https://raw.githubusercontent.com/vladmandic/face-api/master/model"
OUT_DIR="$(dirname "$0")/../public/models"
mkdir -p "$OUT_DIR"

MODELS=(
  ssd_mobilenetv1_model
  face_landmark_68_model
  face_recognition_model
)

for m in "${MODELS[@]}"; do
  echo "--- $m"
  curl -fsSL "$BASE_URL/$m-weights_manifest.json" -o "$OUT_DIR/$m-weights_manifest.json"
  curl -fsSL "$BASE_URL/$m.bin" -o "$OUT_DIR/$m.bin"
done

# InsightFace 512d recognition model (13MB, MobileFaceNet w600k_mbf)
INSIGHT_DIR="$OUT_DIR/insight"
mkdir -p "$INSIGHT_DIR"
if [ ! -f "$INSIGHT_DIR/w600k_mbf.onnx" ]; then
  echo "--- w600k_mbf (InsightFace 512d)"
  # Primary: HuggingFace (requires no auth for this file)
  if ! curl -fsSL "https://huggingface.co/deepinsight/insightface/resolve/main/models/buffalo_sc/w600k_mbf.onnx" -o "$INSIGHT_DIR/w600k_mbf.onnx.tmp"; then
    # Fallback: GitHub release
    curl -fsSL "https://github.com/deepinsight/insightface/releases/download/v0.7/buffalo_sc.zip" -o /tmp/buffalo_sc.zip
    if command -v unzip >/dev/null 2>&1; then
      unzip -j /tmp/buffalo_sc.zip "w600k_mbf.onnx" -d "$INSIGHT_DIR"
    else
      python3 -c "import zipfile; zipfile.ZipFile('/tmp/buffalo_sc.zip').extract('w600k_mbf.onnx', '$INSIGHT_DIR')"
      mv "$INSIGHT_DIR/w600k_mbf.onnx" "$INSIGHT_DIR/w600k_mbf.onnx" 2>/dev/null || true
    fi
    rm -f /tmp/buffalo_sc.zip
  else
    mv "$INSIGHT_DIR/w600k_mbf.onnx.tmp" "$INSIGHT_DIR/w600k_mbf.onnx"
  fi
else
  echo "--- w600k_mbf already exists"
fi

# glintr100 (250MB, antelopev2, ResNet100, max precision — 200MB+ model)
# This is the max-accuracy 512d recogniser used by local-runner-py and Android.
# Falls back to GitHub release if HuggingFace throttles.
if [ ! -f "$INSIGHT_DIR/glintr100.onnx" ] || [ "${FORCE_GLINTR:-0}" = "1" ]; then
  echo "--- glintr100 (antelopev2, 250MB, max precision)"
  if ! curl -fsSL --retry 3 "https://huggingface.co/deepinsight/insightface/resolve/main/models/antelopev2/glintr100.onnx" -o "$INSIGHT_DIR/glintr100.onnx.tmp"; then
    echo "HuggingFace failed, trying GitHub release..."
    curl -fsSL "https://github.com/deepinsight/insightface/releases/download/v0.7/antelopev2.zip" -o /tmp/antelopev2.zip
    if command -v unzip >/dev/null 2>&1; then
      unzip -j /tmp/antelopev2.zip "glintr100.onnx" -d "$INSIGHT_DIR"
    else
      python3 -c "import zipfile; z=zipfile.ZipFile('/tmp/antelopev2.zip'); z.extract('glintr100.onnx', '$INSIGHT_DIR')"
    fi
    rm -f /tmp/antelopev2.zip
  else
    mv "$INSIGHT_DIR/glintr100.onnx.tmp" "$INSIGHT_DIR/glintr100.onnx"
  fi
  # verify size > 100MB (catch HTML error pages)
  if [ -f "$INSIGHT_DIR/glintr100.onnx" ]; then
    SZ=$(stat -c%s "$INSIGHT_DIR/glintr100.onnx" 2>/dev/null || stat -f%z "$INSIGHT_DIR/glintr100.onnx" 2>/dev/null || echo 0)
    if [ "$SZ" -lt 100000000 ]; then
      echo "WARNING: glintr100.onnx suspiciously small ($SZ bytes) — likely a 404 HTML page. Removing."
      rm -f "$INSIGHT_DIR/glintr100.onnx"
    else
      echo "glintr100 OK: $(numfmt --to=iec-i --suffix=B $SZ 2>/dev/null || echo "$SZ bytes")"
    fi
  fi
else
  echo "--- glintr100 already exists ($(du -h "$INSIGHT_DIR/glintr100.onnx" | cut -f1))"
fi

# SCRFD 500M detector (205MB, 5-point landmarks) — replaces ssd_mobilenetv1 for max precision
if [ ! -f "$INSIGHT_DIR/det_500m.onnx" ] || [ "${FORCE_DET:-0}" = "1" ]; then
  echo "--- det_500m (SCRFD 500M, 205MB)"
  if ! curl -fsSL --retry 3 "https://huggingface.co/deepinsight/insightface/resolve/main/models/buffalo_l/det_10g.onnx" -o "$INSIGHT_DIR/det_500m.onnx.tmp"; then
    echo "Primary det_500m fetch failed, trying scrfd_500m_bnkps..."
    curl -fsSL "https://huggingface.co/deepinsight/insightface/resolve/main/models/buffalo_l/scrfd_500m_bnkps_shape640x640.onnx" -o "$INSIGHT_DIR/det_500m.onnx.tmp" || true
  fi
  if [ -f "$INSIGHT_DIR/det_500m.onnx.tmp" ]; then
    mv "$INSIGHT_DIR/det_500m.onnx.tmp" "$INSIGHT_DIR/det_500m.onnx"
    SZ=$(stat -c%s "$INSIGHT_DIR/det_500m.onnx" 2>/dev/null || stat -f%z "$INSIGHT_DIR/det_500m.onnx" 2>/dev/null || echo 0)
    if [ "$SZ" -lt 1000000 ]; then
      echo "WARNING: det_500m.onnx too small ($SZ) — removing"
      rm -f "$INSIGHT_DIR/det_500m.onnx"
    else
      echo "det_500m OK: $(numfmt --to=iec-i --suffix=B $SZ 2>/dev/null || echo "$SZ bytes") (SCRFD 2.5MB is normal for 10g/500m)"
    fi
  fi
else
  echo "--- det_500m already exists ($(du -h "$INSIGHT_DIR/det_500m.onnx" | cut -f1 2>/dev/null || echo "?"))"
fi

# Keep legacy w600k_mbf as fallback (13MB) — already handled above

echo ""
echo "Downloaded:"
ls -lh "$OUT_DIR"
ls -lh "$INSIGHT_DIR" 2>/dev/null || true
