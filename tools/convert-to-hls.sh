#!/usr/bin/env bash
# ------------------------------------------------------------------
# LittleRoots - convert a video into TV/mobile-ready streaming files
# ------------------------------------------------------------------
# Turns one video (e.g. bedtime-noah.mp4) into an HLS folder with
# 2 quality levels (720p / 480p), so the app automatically drops
# quality on slow internet instead of buffering.
# A 5-minute video comes out at about 160 MB, so ~60 videos fit in
# Cloudflare R2's free 10 GB. Add 1080p (about 350 MB per 5 min) with:
#   INCLUDE_1080=1 ./convert-to-hls.sh video.mp4
#
# Requirements: FFmpeg (free) - https://ffmpeg.org/download.html
#   Mac:      brew install ffmpeg
#   Windows:  winget install ffmpeg   (then run this in Git Bash or WSL)
#   Linux:    sudo apt install ffmpeg
#
# Usage:
#   ./convert-to-hls.sh path/to/video.mp4            -> output/<video-name>/
#   ./convert-to-hls.sh path/to/video.mp4 my-slug    -> output/my-slug/
#   ./convert-to-hls.sh videos/*.mp4                 -> converts every file
#
# Output per video:
#   output/<slug>/master.m3u8        <- the link the app plays
#   output/<slug>/720p/ 480p/        <- the quality levels (6-second chunks)
#   output/<slug>/thumbnail.jpg      <- poster image for the app rows
# ------------------------------------------------------------------
set -euo pipefail

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "FFmpeg is not installed. See the instructions at the top of this script." >&2
  exit 1
fi

if [ "$#" -lt 1 ]; then
  echo "Usage: $0 video.mp4 [slug]   or   $0 videos/*.mp4" >&2
  exit 1
fi

OUT_ROOT="output"

# Make a URL-friendly name: "Bedtime Noah's Ark.mp4" -> "bedtime-noahs-ark"
slugify() {
  basename "$1" | sed -E 's/\.[^.]+$//' | tr '[:upper:]' '[:lower:]' \
    | sed -E "s/'//g; s/[^a-z0-9]+/-/g; s/^-+|-+$//g"
}

convert_one() {
  local input="$1" slug="$2"
  local out="$OUT_ROOT/$slug"

  if [ ! -f "$input" ]; then
    echo "Skipping - file not found: $input" >&2
    return
  fi

  echo ""
  echo "=== Converting: $input  ->  $out ==="

  # Quality levels: name, height, video bitrate, maxrate, bufsize
  local levels=()
  if [ "${INCLUDE_1080:-0}" = "1" ]; then
    levels+=("1080p 1080 5000k 5350k 7500k")
  fi
  levels+=("720p 720 2800k 3000k 4200k" "480p 480 1200k 1300k 1800k")

  # Does the video have sound? (Some animations might not.)
  local has_audio
  has_audio=$(ffprobe -v error -select_streams a -show_entries stream=index -of csv=p=0 "$input" | head -n1 || true)

  local n=${#levels[@]} i=0 split_out="" scales="" var_map=""
  local map_args=() rate_args=()
  for lvl in "${levels[@]}"; do
    read -r name height br maxr buf <<<"$lvl"
    mkdir -p "$out/$name"
    split_out+="[s$i]"
    scales+="; [s$i]scale=-2:$height[v$i]"
    map_args+=(-map "[v$i]")
    [ -n "$has_audio" ] && map_args+=(-map 0:a:0)
    rate_args+=(-b:v:$i "$br" -maxrate:v:$i "$maxr" -bufsize:v:$i "$buf")
    if [ -n "$has_audio" ]; then var_map+="v:$i,a:$i,name:$name "; else var_map+="v:$i,name:$name "; fi
    i=$((i + 1))
  done

  # H.264 + AAC plays on LG webOS, Hisense VIDAA, iPhone and Android.
  ffmpeg -hide_banner -loglevel warning -stats -y -i "$input" \
    -filter_complex "[0:v]split=$n$split_out$scales" \
    "${map_args[@]}" \
    -c:v libx264 -preset veryfast -profile:v high -pix_fmt yuv420p \
    -sc_threshold 0 -g 48 -keyint_min 48 \
    "${rate_args[@]}" \
    -c:a aac -b:a 128k -ac 2 \
    -f hls -hls_time 6 -hls_playlist_type vod \
    -hls_flags independent_segments \
    -hls_segment_filename "$out/%v/seg_%03d.ts" \
    -master_pl_name master.m3u8 \
    -var_stream_map "${var_map% }" \
    "$out/%v/index.m3u8"

  # Poster image taken 3 seconds in (falls back to the first frame).
  ffmpeg -hide_banner -loglevel error -y -ss 3 -i "$input" -frames:v 1 \
    -vf "scale=640:-2" -q:v 3 "$out/thumbnail.jpg" \
  || ffmpeg -hide_banner -loglevel error -y -i "$input" -frames:v 1 \
    -vf "scale=640:-2" -q:v 3 "$out/thumbnail.jpg"

  # Duration in whole minutes, handy for the catalog.
  local secs
  secs=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$input" | cut -d. -f1)
  echo "Done: $out/master.m3u8  (length: $((secs / 60)) min $((secs % 60)) s, size: $(du -sh "$out" | cut -f1))"
}

# One file with an explicit slug, or one-or-more files with auto slugs.
if [ "$#" -eq 2 ] && [ -f "$1" ] && [ ! -f "$2" ]; then
  convert_one "$1" "$2"
else
  for f in "$@"; do convert_one "$f" "$(slugify "$f")"; done
fi

echo ""
echo "All done. Upload the contents of '$OUT_ROOT/' to your R2 bucket (see README-video-hosting.md)."
