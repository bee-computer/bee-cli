#!/usr/bin/env bash
set -euo pipefail

VERSION="${1-}"

if [[ -z "$VERSION" ]]; then
  echo "Usage: $0 <version|major|minor|patch|prerelease>"
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Working tree is not clean. Commit or stash changes before releasing."
  exit 1
fi

bun install
bun run typecheck
bun run build

npm version "$VERSION" -m "chore(release): %s"

bun publish --access public
git push --follow-tags
