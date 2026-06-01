#!/usr/bin/env bash
# Converts all .webm files in output/raw/ to MP4 in output/
# Requires ffmpeg. Install: brew install ffmpeg
set -euo pipefail

SRC="$(dirname "$0")/output/raw"
DST="$(dirname "$0")/output"
mkdir -p "$DST"

shopt -s nullglob
for webm in "$SRC"/**/*.webm; do
  name=$(basename "${webm%.webm}")
  out="$DST/${name}.mp4"
  echo "Converting: $webm → $out"
  ffmpeg -y -i "$webm" -c:v libx264 -pix_fmt yuv420p -movflags +faststart "$out"
done
echo "Done. MP4s in $DST/"
