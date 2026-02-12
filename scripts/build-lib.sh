#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_LIB="$ROOT_DIR/dist/lib"
ENTRY="$ROOT_DIR/sources/lib/index.ts"

rm -rf "$DIST_LIB"
mkdir -p "$DIST_LIB"

bun build "$ENTRY" \
  --bundle \
  --format=esm \
  --target=node \
  --outfile "$DIST_LIB/index.js"

tsc -p "$ROOT_DIR/tsconfig.lib.json"
