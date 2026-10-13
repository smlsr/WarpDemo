#!/bin/sh
# Install the WARPDEMO Cursor rule at the repo root. Never overwrites a file that differs; --check shows drift.
set -e
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/.." && pwd)
src="$here/repo-root/.cursor/rules/warpdemo/core.mdc"
dst="$root/.cursor/rules/warpdemo/core.mdc"
if [ "$1" = "--check" ]; then
  if [ ! -f "$dst" ]; then echo "missing: .cursor/rules/warpdemo/core.mdc"; exit 1; fi
  if cmp -s "$src" "$dst"; then echo "ok: .cursor/rules/warpdemo/core.mdc"; else echo "drift: .cursor/rules/warpdemo/core.mdc differs from WARPDEMO/repo-root"; exit 1; fi
  exit 0
fi
mkdir -p "$(dirname "$dst")"
if [ -f "$dst" ] && ! cmp -s "$src" "$dst" && [ "$1" != "--rules" ]; then
  echo "kept: .cursor/rules/warpdemo/core.mdc differs; run with --rules to replace it"
  exit 0
fi
cp "$src" "$dst"
echo "installed: .cursor/rules/warpdemo/core.mdc"
