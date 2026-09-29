#!/bin/sh
# Prism Code native installer (plan 140 Task 4).
#
#   curl -fsSL https://raw.githubusercontent.com/ashiqrniloy/prism/main/install.sh | sh
#   curl -fsSL .../install.sh | sh -s -- --version 0.4.0
#   curl -fsSL .../install.sh | sh -s -- --uninstall
#   curl -fsSL .../install.sh | sh -s -- --modify-path
#
# Installs the self-contained `prism-code` binary (no Bun or npm needed) into
# ${PRISM_HOME:-$HOME/.prism}/bin. HTTPS only; the archive is verified against the release's
# SHA256SUMS before anything is installed. `PRISM_CODE_REGISTRY_BASE_URL` and
# `PRISM_CODE_RELEASE_BASE_URL` exist for the fixture-server tests; both are still HTTPS-enforced.
set -eu

REPO="ashiqrniloy/prism"
PRISM_HOME="${PRISM_HOME:-$HOME/.prism}"
BIN_DIR="$PRISM_HOME/bin"
TARGET_BIN="$BIN_DIR/prism-code"
REGISTRY_BASE="${PRISM_CODE_REGISTRY_BASE_URL:-https://registry.npmjs.org}"
RELEASES_BASE="${PRISM_CODE_RELEASE_BASE_URL:-https://github.com/$REPO/releases/download}"

die() { echo "install.sh: $*" >&2; exit 1; }
info() { echo "$*"; }
fetch() { curl --proto '=https' --tlsv1.2 -fsSL "$1"; }
download() { curl --proto '=https' --tlsv1.2 -fsSL -o "$2" "$1"; }

usage() {
  cat <<'EOF'
Prism Code installer

Usage: install.sh [options]

Options:
  --version <x.y.z>   Install a specific version (default: latest on npm)
  --uninstall         Remove the prism-code binary (keeps user data)
  --modify-path       Append ~/.prism/bin to the shell rc when it is missing
  -h, --help          Show this help
EOF
}

VERSION="${PRISM_CODE_VERSION:-}"
UNINSTALL=0
MODIFY_PATH=0
while [ $# -gt 0 ]; do
  case "$1" in
    --version) [ $# -ge 2 ] || die "--version requires a value"; VERSION="$2"; shift 2 ;;
    --version=*) VERSION="${1#--version=}"; shift ;;
    --uninstall) UNINSTALL=1; shift ;;
    --modify-path) MODIFY_PATH=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown option: $1 (use --help)" ;;
  esac
done

if [ "$UNINSTALL" -eq 1 ]; then
  if [ -f "$TARGET_BIN" ]; then
    rm -f "$TARGET_BIN"
    info "Removed $TARGET_BIN"
  else
    info "Nothing to remove: $TARGET_BIN does not exist"
  fi
  info "User data (config, sessions, credentials) stays in $PRISM_HOME."
  info "Remove it with: rm -rf \"$PRISM_HOME\""
  exit 0
fi

os=$(uname -s)
case "$os" in
  Linux) os=linux ;;
  Darwin) os=darwin ;;
  MINGW*|MSYS*|CYGWIN*|Windows_NT)
    die "Windows is not supported by this installer. Install Bun and run: bun add -g @arnilo/prism-code" ;;
  *) die "unsupported operating system: $os. Install with Bun instead: bun add -g @arnilo/prism-code" ;;
esac

arch=$(uname -m)
case "$arch" in
  x86_64|amd64) arch=x64 ;;
  arm64|aarch64) arch=arm64 ;;
  *) die "unsupported architecture: $arch. Install with Bun instead: bun add -g @arnilo/prism-code" ;;
esac

target="$os-$arch"
if [ "$os" = linux ]; then
  if { command -v ldd >/dev/null 2>&1 && ldd --version 2>&1 | grep -qi musl; } || ls /lib/ld-musl-* >/dev/null 2>&1; then
    target="$target-musl"
  fi
fi

if [ -z "$VERSION" ]; then
  document=$(fetch "$REGISTRY_BASE/@arnilo/prism-code/latest") || die "could not resolve the latest version from $REGISTRY_BASE"
  VERSION=$(printf '%s' "$document" | tr ',' '\n' | sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)
  [ -n "$VERSION" ] || die "could not parse a version from the $REGISTRY_BASE response"
fi
printf '%s' "$VERSION" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$' ||
  die "invalid version: $VERSION"

release="$RELEASES_BASE/prism-code-v$VERSION"
archive_name="prism-code-$target.tar.gz"
work=$(mktemp -d "${TMPDIR:-/tmp}/prism-code-install.XXXXXX") || die "could not create a temporary directory"
install_tmp="$BIN_DIR/.prism-code.tmp.$$"
cleanup() { rm -rf "$work"; rm -f "$install_tmp"; }
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

info "Installing prism-code $VERSION ($target)..."
download "$release/$archive_name" "$work/$archive_name" || die "could not download $release/$archive_name"
download "$release/SHA256SUMS" "$work/SHA256SUMS" || die "could not download $release/SHA256SUMS"

expected=$(awk -v name="$archive_name" '$2 == name { print $1; exit }' "$work/SHA256SUMS")
[ -n "$expected" ] || die "SHA256SUMS has no entry for $archive_name"
if command -v sha256sum >/dev/null 2>&1; then
  actual=$(sha256sum "$work/$archive_name" | awk '{print $1}')
elif command -v shasum >/dev/null 2>&1; then
  actual=$(shasum -a 256 "$work/$archive_name" | awk '{print $1}')
else
  die "neither sha256sum nor shasum is available to verify the download"
fi
[ "$actual" = "$expected" ] || die "checksum mismatch for $archive_name (expected $expected, got $actual)"

tar -xzf "$work/$archive_name" -C "$work" prism-code || die "could not extract prism-code from $archive_name"
mkdir -p "$BIN_DIR" || die "could not create $BIN_DIR"
chmod 700 "$PRISM_HOME" "$BIN_DIR" || die "could not set permissions on $BIN_DIR"
cp "$work/prism-code" "$install_tmp" || die "could not stage the binary"
chmod 755 "$install_tmp"
mv -f "$install_tmp" "$TARGET_BIN" || die "could not install to $TARGET_BIN"

case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *)
    case "$(basename "${SHELL:-sh}")" in
      fish) rc="$HOME/.config/fish/config.fish"; line="fish_add_path \"$BIN_DIR\"" ;;
      zsh) rc="$HOME/.zshrc"; line="export PATH=\"$BIN_DIR:\$PATH\"" ;;
      *) rc="$HOME/.bashrc"; line="export PATH=\"$BIN_DIR:\$PATH\"" ;;
    esac
    info ""
    info "prism-code is installed, but $BIN_DIR is not on your PATH."
    info "Add it with:"
    info "  $line"
    if [ "$MODIFY_PATH" -eq 1 ]; then
      mkdir -p "$(dirname "$rc")"
      if [ -f "$rc" ] && grep -qF "$BIN_DIR" "$rc"; then
        info "Already present in $rc"
      else
        printf '\n# Added by the Prism Code installer\n%s\n' "$line" >>"$rc"
        info "Appended the line to $rc (restart your shell or source it)"
      fi
    else
      info "Or re-run this installer with --modify-path to append it."
    fi
    ;;
esac

info "Installed prism-code $VERSION to $TARGET_BIN"
