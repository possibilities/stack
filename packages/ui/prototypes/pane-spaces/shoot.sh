#!/bin/sh
# PROTOTYPE — capture one prototype state with a throwaway headless Chrome (temporary profile, never the human's browser).
# usage: shoot.sh <name> "<query>" [width] [height]
set -eu
here=$(cd "$(dirname "$0")" && pwd)
name=$1; query=$2; w=${3:-1600}; h=${4:-1000}
profile=$(mktemp -d /tmp/pane-shots.XXXXXX)
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --hide-scrollbars --no-first-run --no-default-browser-check \
  --user-data-dir="$profile" --force-device-scale-factor=1 --window-size="$w,$h" --virtual-time-budget=${BUDGET:-2500} \
  --screenshot="$here/shots/$name.png" "http://127.0.0.1:${PORT:-8797}/index.html?shots=1&theme=light&$query" >/dev/null 2>&1 || true
rm -rf "$profile"
echo "$here/shots/$name.png"
