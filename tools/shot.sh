#!/bin/sh
# Headless screenshot of the running game (needs the local server on :8642).
# usage: tools/shot.sh "<query string>" <out.png> [width] [height] [virtual_ms]
#   e.g. tools/shot.sh "level=1&nocut&test&nohud&pose=0,64,0,-0.15" /tmp/l1.png
# pose = x,z,yaw,pitch (feet snapped to the ground). Runs one Chrome at a time (lock) to spare the 8 GB laptop.
Q="$1"; OUT="$2"; W=${3:-960}; H=${4:-540}; B=${5:-9000}
BASE="${TMPDIR:-/tmp}/starless-shot"
mkdir -p "$BASE"
LOCK="$BASE/lock"
n=0; while ! mkdir "$LOCK" 2>/dev/null; do sleep 1; n=$((n+1)); [ $n -gt 120 ] && rmdir "$LOCK" 2>/dev/null; done
trap 'rmdir "$LOCK" 2>/dev/null' EXIT INT TERM
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --use-angle=metal --enable-unsafe-swiftshader \
  --user-data-dir="$BASE/profile" --window-size="$W,$H" --hide-scrollbars --mute-audio \
  --virtual-time-budget="$B" --screenshot="$OUT" "http://localhost:8642/?$Q" >/dev/null 2>&1
[ -f "$OUT" ] && echo "saved $OUT" || echo "screenshot failed"
