#!/bin/sh
# repo-intel installer — puts the latest release on your PATH.
# Usage: curl -fsSL https://tyom.github.io/repo-intel/install.sh | sh
#   Override the target dir with REPO_INTEL_BIN=/some/dir
set -eu

repo="tyom/repo-intel"
asset="https://github.com/${repo}/releases/latest/download/repo-intel"
bin_dir="${REPO_INTEL_BIN:-$HOME/.local/bin}"
dest="${bin_dir}/repo-intel"

command -v python3 >/dev/null 2>&1 || {
  echo "error: python3 not found — repo-intel needs Python 3." >&2
  exit 1
}

if command -v curl >/dev/null 2>&1; then
  fetch() { curl -fsSL "$1" -o "$2"; }
elif command -v wget >/dev/null 2>&1; then
  fetch() { wget -qO "$2" "$1"; }
else
  echo "error: need curl or wget to download repo-intel." >&2
  exit 1
fi

mkdir -p "$bin_dir"
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT INT TERM

echo "Downloading repo-intel (latest release)…"
fetch "$asset" "$tmp"

# Guard against a 404/HTML error page being installed (e.g. before any release).
if ! head -1 "$tmp" | grep -q '^#!/usr/bin/env python3'; then
  echo "error: download didn't look like repo-intel (no release yet?)." >&2
  exit 1
fi

chmod +x "$tmp"
mv "$tmp" "$dest"
trap - EXIT INT TERM
echo "Installed → $dest"

case ":$PATH:" in
  *":$bin_dir:"*) ;;
  *) echo "note: $bin_dir is not on PATH. Add: export PATH=\"$bin_dir:\$PATH\"" ;;
esac

echo "Run: repo-intel --help"
