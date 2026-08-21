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

echo ""
echo "Downloaded:"
ls -la "$OUT_DIR"
