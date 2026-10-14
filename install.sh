#!/bin/bash
set -euo pipefail
if [[ "$(uname -s)" != "Darwin" ]]; then echo 'This helper requires macOS.' >&2; exit 1; fi
if ! command -v node >/dev/null; then echo 'Install Node.js 24+ first.' >&2; exit 1; fi
node -e 'if (+process.versions.node.split(".")[0] < 24) process.exit(1)' || { echo 'Node.js 24+ required.' >&2; exit 1; }
command -v xcrun >/dev/null || { echo 'Install Xcode Command Line Tools with: xcode-select --install' >&2; exit 1; }
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="$HOME/.local/share/council-remote-helper/app"
mkdir -p "$DEST/bin" "$DEST/lib" "$DEST/native" "$HOME/.local/bin"
chmod 700 "$DEST" "$DEST/bin" "$DEST/lib" "$DEST/native"
cp "$ROOT/bin/remote.mjs" "$DEST/bin/remote.mjs"
cp "$ROOT"/lib/*.mjs "$DEST/lib/"
cp "$ROOT/native/remote-native.swift" "$DEST/native/remote-native.swift"
xcrun swiftc -O "$DEST/native/remote-native.swift" -o "$DEST/native/remote-native"
chmod 700 "$DEST/native/remote-native" "$DEST/bin/remote.mjs"
ln -sfn "$DEST/bin/remote.mjs" "$HOME/.local/bin/council-remote"
for n in 00 01 02 03 04; do ln -sfn "$DEST/bin/remote.mjs" "$HOME/.local/bin/$n"; done
printf 'Council Remote Helper installed to %s\nCommands: 00 01 02 03 04.\n' "$DEST"
printf 'Ensure ~/.local/bin is on your PATH.\n'
if [[ -t 0 && -t 1 ]]; then
  echo 'Sign in with your existing Council Editor username and PIN:'
  node "$DEST/bin/remote.mjs" login
else
  echo 'Sign in from an interactive terminal: council-remote login'
fi
