#!/bin/zsh
# Render every store screenshot to brand/screenshots/out/<id>.png at 1280x800.
#
#   ./brand/screenshots/shoot.sh
#
# A local server is required: the harness imports the real panel as an ES
# module, and module imports are blocked over file://. Served from the repo
# root so /src and /public resolve exactly as they do in the extension.
#
# Drop a real 1280px-wide page capture at backdrops/<scene-id>.png and that
# scene composites over it automatically. Scenes without one render on the
# brand backdrop.
#
# The panel honours prefers-color-scheme, and headless Chrome reports dark --
# which renders a dark card on a dark scrim and loses the subject. Store shots
# are forced to light; pass --dark for the dark-mode set.
set -e

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
HERE="${0:A:h}"
ROOT="${HERE:h:h}"
OUT="$HERE/out"
PORT=8731
SCHEME=1                      # blink preferredColorScheme: 1 light, 2 dark
[[ "$1" == "--dark" ]] && SCHEME=2 && OUTDIR_SUFFIX="-dark" || OUTDIR_SUFFIX=""

[[ -x "$CHROME" ]] || { print -u2 "Chrome not found at $CHROME"; exit 1; }

OUT="$OUT$OUTDIR_SUFFIX"
mkdir -p "$OUT"
python3 -m http.server "$PORT" --directory "$ROOT" --bind 127.0.0.1 >/dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null' EXIT

# Wait for the port rather than sleeping a guessed interval.
for _ in {1..50}; do
  curl -sf -o /dev/null "http://127.0.0.1:$PORT/public/styles.css" && break
  sleep 0.1
done

scenes=(${(f)"$(grep -o "id: '[a-z-]*'" "$HERE/scenes.js" | sed "s/id: '//;s/'//")"})

for id in $scenes; do
  q="scene=$id"
  [[ -f "$HERE/backdrops/$id.png" ]] && q="$q&backdrop=1" && note=" (over backdrops/$id.png)" || note=""
  "$CHROME" --headless --disable-gpu --hide-scrollbars \
    --force-device-scale-factor=1.28 --window-size=1000,625 \
    --blink-settings=preferredColorScheme=$SCHEME \
    --virtual-time-budget=4000 \
    --screenshot="$OUT/$id.png" \
    "http://127.0.0.1:$PORT/brand/screenshots/harness.html?$q" >/dev/null 2>&1
  if [[ -f "$OUT/$id.png" ]]; then
    size=$(python3 -c "
import struct,sys
d=open(sys.argv[1],'rb').read(24)
print('%dx%d' % struct.unpack('>II', d[16:24]))" "$OUT/$id.png")
    print "  $id -> ${OUT:t}/$id.png  $size$note"
  else
    print -u2 "  $id -> FAILED"
  fi
done
