#!/usr/bin/env bash
set -e

echo "=== Render Demo Video Pipeline ==="
echo ""

# Run all Playwright demos in priority order
DEMOS=(
  "demo:04"
  "demo:03"
  "demo:01"
  "demo:06"
  "demo:02"
  "demo:05"
)

for script in "${DEMOS[@]}"; do
  echo "▶ Running $script..."
  npm run "$script" || { echo "✗ $script failed"; exit 1; }
  echo "✓ $script complete"
  echo ""
done

echo "=== Converting webm → mp4 ==="
echo ""

# Find all webm files and convert
find output -name "*.webm" | while read -r webm; do
  # Extract demo number from path
  name=$(basename "$(dirname "$webm")")
  mp4="output/${name}.mp4"
  echo "Converting: $webm → $mp4"
  ffmpeg -y -i "$webm" -c:v libx264 -pix_fmt yuv420p -movflags +faststart "$mp4" -loglevel error
  echo "✓ $mp4"
done

echo ""
echo "=== Done ==="
ls -lh output/*.mp4 2>/dev/null || echo "No MP4s found — check output/ for webm files"
