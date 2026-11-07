#!/usr/bin/env bash
# Installs the latest Termeedor release from GitHub on macOS or Linux.
#   curl -fsSL https://raw.githubusercontent.com/juancresc/termeedor/master/scripts/install.sh | bash
set -euo pipefail

BASE_URL="${TERMEEDOR_BASE_URL:-https://github.com/juancresc/termeedor/releases/latest/download}"

# Each package format has its own name for x64.
case "$(uname -m)" in
  arm64 | aarch64) mac_arch=arm64 deb_arch=arm64 appimage_arch=arm64 ;;
  x86_64 | amd64) mac_arch=x64 deb_arch=amd64 appimage_arch=x86_64 ;;
  *) echo "Unsupported CPU: $(uname -m)" >&2; exit 1 ;;
esac

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

download() { # <file name>
  echo "Downloading $1..."
  curl -fL --progress-bar -o "$tmp/$1" "$BASE_URL/$1"
}

install_mac() {
  local file="termeedor-mac-$mac_arch.zip" apps="${TERMEEDOR_APP_DIR:-/Applications}"
  download "$file"
  [ -w "$apps" ] || { apps="$HOME/Applications"; mkdir -p "$apps"; }
  ditto -x -k "$tmp/$file" "$tmp/app"
  rm -rf "$apps/Termeedor.app"
  mv "$tmp/app/Termeedor.app" "$apps/"
  echo "Installed to $apps/Termeedor.app"
}

install_deb() {
  local file="termeedor-linux-$deb_arch.deb"
  download "$file"
  chmod a+r "$tmp/$file"
  chmod a+rx "$tmp" # apt's unprivileged user has to be able to read it
  sudo apt-get install -y "$tmp/$file"
  echo "Installed. Run: termeedor"
}

install_appimage() {
  local file="termeedor-linux-$appimage_arch.AppImage"
  local bin="$HOME/.local/bin/termeedor"
  local entry="${XDG_DATA_HOME:-$HOME/.local/share}/applications/termeedor.desktop"
  download "$file"
  mkdir -p "$(dirname "$bin")" "$(dirname "$entry")"
  install -m 755 "$tmp/$file" "$bin"
  cat >"$entry" <<EOF
[Desktop Entry]
Type=Application
Name=Termeedor
Comment=Terminal with tab groups and plugins
Exec=$bin
Terminal=false
Categories=Development;
EOF
  echo "Installed to $bin"
  case ":$PATH:" in
    *":$HOME/.local/bin:"*) ;;
    *) echo "Add $HOME/.local/bin to your PATH to run it as: termeedor" ;;
  esac
}

case "$(uname -s)" in
  Darwin) install_mac ;;
  Linux)
    if command -v apt-get >/dev/null 2>&1; then install_deb; else install_appimage; fi
    ;;
  *) echo "Unsupported OS: $(uname -s)" >&2; exit 1 ;;
esac
