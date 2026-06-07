#!/usr/bin/env bash
# Converts each recorded clip's .webm to an MP4 named after the clip.
# Recordings land in output/raw/<clip>/<test-dir>/*.webm (see `task demo:record`,
# which passes --output=output/raw/<clip>). Requires ffmpeg: brew install ffmpeg
set -euo pipefail

SRC="$(dirname "$0")/output/raw"
DST="$(dirname "$0")/output"
mkdir -p "$DST"

shopt -s nullglob
for dir in "$SRC"/*/; do
  webm=$(find "$dir" -name '*.webm' | head -1)
  [ -z "$webm" ] && continue
  vid=$(basename "$dir")              # e.g. artist-signup
  out="$DST/${vid}.mp4"
  echo "Converting: $webm → $out"
  ffmpeg -y -i "$webm" -c:v libx264 -pix_fmt yuv420p -movflags +faststart "$out"
done
echo "Done. MP4s in $DST/"
