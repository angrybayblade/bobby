#!/usr/bin/env bash
# Installs the bobby binary from GitHub Releases.
#
#   curl -fsSL https://raw.githubusercontent.com/angrybayblade/bobby/main/install.sh | bash
#
# Options, as environment variables:
#   BOBBY_VERSION=0.1.0-rc1     a specific release tag (default: the latest, or the newest pre-release if
#                               there's no stable one yet)
#   BOBBY_INSTALL_DIR=~/bin     where to put the binary (default: ~/.local/bin)
#
#   curl -fsSL …/install.sh | BOBBY_VERSION=0.1.0-rc1 bash
set -euo pipefail

REPO="angrybayblade/bobby"
INSTALL_DIR="${BOBBY_INSTALL_DIR:-$HOME/.local/bin}"

say() { printf '  %s\n' "$*"; }
die() { printf '  ✗ %s\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 is required to install bobby"; }
need curl
need tar
need uname

# ---- platform
case "$(uname -s)" in
  Darwin) os="darwin" ;;
  Linux) os="linux" ;;
  MINGW* | MSYS* | CYGWIN*) die "On Windows, download bobby-<version>-windows-x64.zip from https://github.com/$REPO/releases" ;;
  *) die "Unsupported OS: $(uname -s)" ;;
esac
case "$(uname -m)" in
  x86_64 | amd64) arch="x64" ;;
  arm64 | aarch64) arch="arm64" ;;
  *) die "Unsupported CPU: $(uname -m)" ;;
esac
# An x64 shell under Rosetta on Apple Silicon: the native build is faster.
if [ "$os" = "darwin" ] && [ "$arch" = "x64" ] && [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)" = "1" ]; then arch="arm64"; fi

# ---- version
tag="${BOBBY_VERSION:-}"
if [ -z "$tag" ]; then
  api="https://api.github.com/repos/$REPO/releases"
  tag_of() { sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -n 1; }
  tag="$(curl -fsSL "$api/latest" 2>/dev/null | tag_of || true)"
  [ -n "$tag" ] || tag="$(curl -fsSL "$api?per_page=1" 2>/dev/null | tag_of || true)" # no stable release yet
  [ -n "$tag" ] || die "Couldn't find a release of $REPO. Set BOBBY_VERSION to pick one."
fi

asset="bobby-$tag-$os-$arch.tar.gz"
base="https://github.com/$REPO/releases/download/$tag"
say "Installing bobby $tag ($os-$arch) into $INSTALL_DIR"

# ---- download and verify
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
curl -fsSL --retry 2 -o "$tmp/$asset" "$base/$asset" || die "Download failed: $base/$asset"
if curl -fsSL -o "$tmp/SHA256SUMS" "$base/SHA256SUMS" 2>/dev/null; then
  want="$(grep " $asset\$" "$tmp/SHA256SUMS" | cut -d' ' -f1)"
  if command -v sha256sum >/dev/null 2>&1; then got="$(sha256sum "$tmp/$asset" | cut -d' ' -f1)"
  else got="$(shasum -a 256 "$tmp/$asset" | cut -d' ' -f1)"; fi
  [ -n "$want" ] && [ "$want" = "$got" ] || die "Checksum mismatch for $asset"
  say "✓ checksum verified"
else
  say "! no SHA256SUMS in this release; skipping the checksum"
fi

# ---- install
tar -xzf "$tmp/$asset" -C "$tmp"
mkdir -p "$INSTALL_DIR"
install -m 755 "$tmp/bobby" "$INSTALL_DIR/bobby" 2>/dev/null || { cp "$tmp/bobby" "$INSTALL_DIR/bobby" && chmod 755 "$INSTALL_DIR/bobby"; }
# Downloaded with curl, so there's normally no quarantine flag; clear it anyway so Gatekeeper never blocks it.
[ "$os" = "darwin" ] && xattr -d com.apple.quarantine "$INSTALL_DIR/bobby" 2>/dev/null || true
say "✓ $("$INSTALL_DIR/bobby" --version 2>/dev/null || echo "$tag") installed at $INSTALL_DIR/bobby"

# ---- what's still missing
case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *) say "! $INSTALL_DIR isn't on your PATH. Add it, e.g.:"
     say "    echo 'export PATH=\"$INSTALL_DIR:\$PATH\"' >> ~/.$(basename "${SHELL:-bash}")rc" ;;
esac
for tool in git gh; do command -v "$tool" >/dev/null 2>&1 || say "! bobby also needs $tool on your PATH"; done
command -v claude >/dev/null 2>&1 || say "  (optional) install the claude CLI for the smarter change tree"
say "Run bobby inside a repo, or bobby <pr-url>."
