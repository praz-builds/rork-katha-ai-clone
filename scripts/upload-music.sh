#!/usr/bin/env bash
#
# Uploads ambient reader music to the public `music` bucket.
#
# The tracks are not in the repo and not in the app binary. They are ~26 MB of
# audio that changes rarely and is licensed rather than authored, so git is the
# wrong home for them and so is every user's download. The bucket is the source
# of truth; the app fetches and caches from it (expo/src/lib/music-cache.ts).
#
# Encode before uploading. HE-AAC at 64 kbps is what the catalogue assumes:
#
#   afconvert -f m4af -d aach -b 64000 in.mp3 <genre>_<nn>.m4a
#
# The object name must match the `file` on the catalogue row exactly, or the
# track 404s at play time and the story reads in silence.
#
# Usage:
#   scripts/upload-music.sh track.m4a [more.m4a ...]
#   scripts/upload-music.sh masters/*.m4a
#
# Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. The service role is the
# only thing that can write here: migration 00093 gives the bucket a read
# policy and no write policy at all.
set -euo pipefail

if [[ $# -eq 0 ]]; then
  echo "usage: $0 <file.m4a> [file.m4a ...]" >&2
  exit 64
fi

: "${SUPABASE_URL:?set SUPABASE_URL (e.g. https://<ref>.supabase.co)}"
: "${SUPABASE_SERVICE_ROLE_KEY:?set SUPABASE_SERVICE_ROLE_KEY}"

base="${SUPABASE_URL%/}"

for file in "$@"; do
  if [[ ! -f "$file" ]]; then
    echo "not a file: $file" >&2
    exit 66
  fi

  name="$(basename "$file")"
  if [[ ! "$name" =~ ^[a-z_]+_[0-9]{2}\.m4a$ ]]; then
    # Caught here rather than at play time: a mismatched name uploads happily
    # and fails silently in the app, for one genre, on every device.
    echo "name must be <genre>_<nn>.m4a, got: $name" >&2
    exit 65
  fi

  # `x-upsert` so re-uploading a corrected encode replaces the object instead
  # of failing on a name that already exists.
  status="$(curl -sS -o /dev/null -w '%{http_code}' \
    -X POST "$base/storage/v1/object/music/$name" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Content-Type: audio/mp4" \
    -H "x-upsert: true" \
    --data-binary "@$file")"

  if [[ "$status" != "200" ]]; then
    echo "FAILED $name (HTTP $status)" >&2
    exit 1
  fi
  echo "uploaded $name -> $base/storage/v1/object/public/music/$name"
done
