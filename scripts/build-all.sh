#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENTRY="$ROOT_DIR/sources/main.ts"
DIST_ROOT="$ROOT_DIR/dist/platforms"

declare -a TARGETS=(
  "linux-x64:bun-linux-x64:bee"
  "linux-arm64:bun-linux-arm64:bee"
  "mac-x64:bun-darwin-x64:bee"
  "mac-arm64:bun-darwin-arm64:bee"
  "windows-x64:bun-windows-x64:bee.exe"
  "windows-arm64:bun-windows-arm64:bee.exe"
)

build_target() {
  local name="$1"
  local bun_target="$2"
  local out_name="$3"

  local out_dir="$DIST_ROOT/$name"
  mkdir -p "$out_dir"
  local outfile="$out_dir/$out_name"

  local args=("build" "$ENTRY" "--compile" "--target=$bun_target" "--outfile" "$outfile")
  local env_key="${name^^}"
  env_key="${env_key//-/_}"
  local target_exec_var="BUN_COMPILE_EXECUTABLE_PATH_${env_key}"
  local target_exec_path="${!target_exec_var-}"
  if [[ -z "$target_exec_path" && -n "${BUN_COMPILE_EXECUTABLE_PATH-}" ]]; then
    target_exec_path="$BUN_COMPILE_EXECUTABLE_PATH"
  fi
  if [[ -n "$target_exec_path" ]]; then
    args+=("--compile-executable-path=$target_exec_path")
  fi

  echo ""
  echo "Building $name -> $outfile"
  if ! output=$(bun "${args[@]}" 2>&1); then
    if echo "$output" | grep -q "Target platform .* is not available for download"; then
      echo "Skipping $name: $output"
      return 0
    fi
    echo "$output"
    return 1
  fi
  echo "$output"
}

for target in "${TARGETS[@]}"; do
  IFS=":" read -r NAME BUN_TARGET OUT_NAME <<< "$target"
  build_target "$NAME" "$BUN_TARGET" "$OUT_NAME"
done
