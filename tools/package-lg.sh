#!/usr/bin/env bash
# Builds the LG webOS TV app package (.ipk) into dist/.
# The package opens the live TV app (tv/webos/index.html), so it only needs rebuilding for a new icon/name/version.
# Usage: bash tools/package-lg.sh     (needs Node; installs LG's free webOS TV command-line tools the first time)
set -euo pipefail
cd "$(dirname "$0")/.."
TOOLS="${WEBOS_TOOLS_DIR:-$HOME/.cache/littleroots-webos-tools}"
if [ ! -x "$TOOLS/node_modules/.bin/ares-package" ]; then
  mkdir -p "$TOOLS" && npm install --prefix "$TOOLS" --no-audit --no-fund @webos-tools/cli@3 >/dev/null
fi
mkdir -p dist
"$TOOLS/node_modules/.bin/ares-package" tv/webos -o dist --no-minify
ls -1 dist/*.ipk
