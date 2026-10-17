#!/usr/bin/env bash
# Builds the LG webOS TV app package (.ipk) into dist/.
# Usage: bash tools/package-lg.sh     (needs Node; installs LG's free webOS TV command-line tools the first time)
set -euo pipefail
cd "$(dirname "$0")/.."
TOOLS="${WEBOS_TOOLS_DIR:-$HOME/.cache/littleroots-webos-tools}"
if [ ! -x "$TOOLS/node_modules/.bin/ares-package" ]; then
  mkdir -p "$TOOLS" && npm install --prefix "$TOOLS" --no-audit --no-fund @webos-tools/cli@3 >/dev/null
fi
[ -d api/node_modules/@babel/core ] || (cd api && npm ci --no-audit --no-fund >/dev/null)
node tools/build-tv.mjs src/littleroots-tv.html tv/webos/index.html api/node_modules
mkdir -p dist
"$TOOLS/node_modules/.bin/ares-package" tv/webos -o dist --no-minify
ls -1 dist/*.ipk
