#!/usr/bin/env bash
# Downloads @vladmandic/face-api model weights into public/models/
set -euo pipefail

BASE_URL="https://raw.githubusercontent.com/vladmandic/face-api/master/model"
OUT_DIR="$(dirname "$0")/../public/models"
mkdir -p "$OUT_DIR"

MODELS=(
  ssd_mobilenetv1_model
  face_landmark_68_model
  face_recognition_model
)

download_model() {
  local name="$1"
  echo "--- $name"
  curl -fsSL "$BASE_URL/$name-weights_manifest.json" -o "$OUT_DIR/$name-weights_manifest.json"

  # Extract shard paths from the manifest and download each one.
  node -e "
    const m = JSON.parse(require('fs').readFileSync('$OUT_DIR/$name-weights_manifest.json', 'utf8'));
    const paths = [...new Set(m.weights.flatMap((w) => w.paths))];
    console.log(paths.join('\n'));
  " | while read -r shard; do
    [ -z "$shard" ] && continue
    echo "    $shard"
    curl -fsSL "$BASE_URL/$shard" -o "$OUT_DIR/$shard"
  done
}

for m in "${MODELS[@]}"; do
  download_model "$m"
done

echo ""
echo "Downloaded:"
ls -la "$OUT_DIR"
