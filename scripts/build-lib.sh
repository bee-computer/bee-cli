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

for declaration_file in "$DIST_LIB"/*.d.ts; do
  # Make declaration specifiers NodeNext-friendly for published ESM types.
  perl -pi -e 's/(from\s+"\.\/[^".]+)"/$1.js"/g; s/(from\s+'\''\.\/[^'\''.]+)'\''/$1.js'\''/g' "$declaration_file"
done
