#!/bin/zsh
# Render brand SVGs to PNG with headless Chrome. No image library needed.
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
render() {  # render <svg> <size> <out>
  local svg="$1" size="$2" out="$3"
  local html="$(mktemp -t spreadicon).html"
  cat > "$html" <<HTML
<style>html,body{margin:0;padding:0;background:transparent}
svg{display:block;width:${size}px;height:${size}px}</style>
$(cat "$svg")
HTML
  "$CHROME" --headless --disable-gpu --hide-scrollbars \
    --default-background-color=00000000 \
    --screenshot="$out" --window-size="$size,$size" "$html" >/dev/null 2>&1
  rm -f "$html"
}
render "$1" "$2" "$3"
