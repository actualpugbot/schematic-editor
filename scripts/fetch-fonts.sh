#!/usr/bin/env bash
# Downloads the self-hosted woff2 files in public/fonts/ from the Google Fonts API.
# The @font-face rules referencing these files live in src/fonts.css; if you change
# the families or weight ranges here, update that file to match.
set -euo pipefail
cd "$(dirname "$0")/.."

# A woff2-capable browser UA so the API serves subsetted woff2 instead of TTF.
UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
OUT=public/fonts
CSSDUMP=${CSSDUMP:-/tmp/gfonts-css}
mkdir -p "$OUT" "$CSSDUMP"

grab() { # grab <css2-family-query> <slug> <var|static>
  local query=$1 slug=$2 kind=$3
  curl -fsS -A "$UA" "https://fonts.googleapis.com/css2?family=${query}&display=swap" \
    > "$CSSDUMP/$slug.css"
  awk '
    /^\/\* / { subset = $2 }
    /font-weight:/ { w = $2; sub(/;/, "", w) }
    /src:/ {
      if (match($0, /https:\/\/[^)]*/)) print subset, w, substr($0, RSTART, RLENGTH)
    }
  ' "$CSSDUMP/$slug.css" |
  while read -r subset weight url; do
    case $subset in latin | latin-ext) ;; *) continue ;; esac
    if [ "$kind" = var ]; then
      name="$slug-$subset.woff2"
    else
      name="$slug-$weight-$subset.woff2"
    fi
    curl -fsS -A "$UA" "$url" -o "$OUT/$name"
    echo "fetched $name"
  done
}

# Weight ranges match what src/styles.css actually uses (heavier values clamp to
# the max here, same as the previous Google-hosted setup).
grab 'Hanken+Grotesk:wght@400..700' hanken-grotesk var
grab 'Bricolage+Grotesque:opsz,wght@12..96,400..700' bricolage-grotesque var
grab 'B612+Mono:wght@400;700' b612-mono static
