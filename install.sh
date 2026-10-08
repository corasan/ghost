#!/bin/sh
# Installs the ghost CLI from the latest GitHub release:
#   curl -fsSL https://raw.githubusercontent.com/corasan/ghost/main/install.sh | sh
set -eu

repo="corasan/ghost"
dir="${GHOST_INSTALL_DIR:-$HOME/.local/bin}"

case "$(uname -s)" in
  Darwin) os=darwin ;;
  Linux) os=linux ;;
  *) echo "Ghost runs on macOS and Linux." >&2; exit 1 ;;
esac

case "$(uname -m)" in
  arm64 | aarch64) arch=arm64 ;;
  x86_64 | amd64) arch=x64 ;;
  *) echo "Unsupported CPU: $(uname -m)" >&2; exit 1 ;;
esac

url="https://github.com/$repo/releases/latest/download/ghost-$os-$arch"
mkdir -p "$dir"
echo "Downloading $url"
curl -fL --progress-bar "$url" -o "$dir/ghost.download"
chmod +x "$dir/ghost.download"
mv "$dir/ghost.download" "$dir/ghost"
echo "Installed $dir/ghost"

case ":$PATH:" in
  *":$dir:"*) ;;
  *) echo "Add $dir to your PATH, for example: echo 'export PATH=\"$dir:\$PATH\"' >> ~/.zshrc" ;;
esac

echo "Next: ghost setup"
