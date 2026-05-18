#!/usr/bin/env bash
set -e

echo "=== Render Demo Video Pipeline ==="
echo ""

mkdir -p videos

run_demo() {
  local script="$1"
  local mp4_name="$2"
  echo "▶ Running $script..."
  npm run "$script" || { echo "✗ $script failed"; exit 1; }
  echo "✓ $script complete"

  local webm
  webm=$(find output -name "*.webm" | head -1)
  if [ -n "$webm" ]; then
    echo "  Converting → videos/${mp4_name}.mp4"
    ffmpeg -y -i "$webm" -c:v libx264 -pix_fmt yuv420p -movflags +faststart "videos/${mp4_name}.mp4" -loglevel error
    echo "  ✓ videos/${mp4_name}.mp4"
  else
    echo "  ⚠ No webm found for $script — skipping conversion"
  fi
  echo ""
}

run_demo "demo:04" "demo-04-organiser-manage"
run_demo "demo:03" "demo-03-artist-apply"
run_demo "demo:01" "demo-01-public-visitor"
run_demo "demo:06" "demo-06-qr-moment"
run_demo "demo:02" "demo-02-artist-profile"
run_demo "demo:05" "demo-05-post-festival-trail"

echo "=== Done ==="
ls -lh videos/*.mp4 2>/dev/null || echo "No MP4s found — check output/ for webm files"
