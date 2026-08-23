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

# Optional: glintr100 (250MB) — uncomment if you want best accuracy and can host it
# curl -fsSL "https://huggingface.co/deepinsight/insightface/resolve/main/models/antelopev2/glintr100.onnx" -o "$INSIGHT_DIR/glintr100.onnx"

echo ""
echo "Downloaded:"
ls -lh "$OUT_DIR"
ls -lh "$INSIGHT_DIR" 2>/dev/null || true
