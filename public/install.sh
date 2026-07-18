#!/bin/sh
# GitStudio Desktop — Linux installer.
#
#   curl -fsSL https://gitstudio.dev/install.sh | sh
#
# Picks the release artifact that matches your distro (.deb / .rpm, falling back
# to the AppImage) and installs it. Everything it downloads comes from the public
# GitHub release: https://github.com/GitStudioHQ/gitstudio/releases
#
# Apache-2.0. Read the source before piping anything to a shell — including this.

set -eu

VERSION="1.0.0"
BASE="https://github.com/GitStudioHQ/gitstudio/releases/download/app-v${VERSION}"

say() { printf '  %s\n' "$1"; }
die() { printf '\n  error: %s\n\n' "$1" >&2; exit 1; }

printf '\n  GitStudio Desktop %s\n\n' "$VERSION"

# ---- architecture ----------------------------------------------------------
ARCH="$(uname -m)"
case "$ARCH" in
	x86_64 | amd64) ;;
	*) die "unsupported architecture: ${ARCH} (x86-64 only for now — arm64 is coming)" ;;
esac

# ---- fetcher ---------------------------------------------------------------
if command -v curl >/dev/null 2>&1; then
	fetch() { curl -fL --progress-bar "$1" -o "$2"; }
elif command -v wget >/dev/null 2>&1; then
	fetch() { wget -q --show-progress -O "$2" "$1"; }
else
	die "need curl or wget"
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# ---- AppImage fallback (no root needed) ------------------------------------
install_appimage() {
	FILE="GitStudio-${VERSION}-x86_64.AppImage"
	DEST="${HOME}/.local/bin"
	say "installing the AppImage to ${DEST}"
	mkdir -p "$DEST"
	fetch "${BASE}/${FILE}" "${DEST}/gitstudio"
	chmod +x "${DEST}/gitstudio"
	printf '\n  installed: %s/gitstudio\n' "$DEST"
	case ":${PATH}:" in
		*":${DEST}:"*) ;;
		*) say "note: ${DEST} is not on your PATH" ;;
	esac
	printf '\n  run it with:  gitstudio\n\n'
	exit 0
}

# ---- privilege -------------------------------------------------------------
SUDO=""
if [ "$(id -u)" -ne 0 ]; then
	if command -v sudo >/dev/null 2>&1; then
		SUDO="sudo"
	else
		say "no root and no sudo — falling back to the AppImage"
		install_appimage
	fi
fi

# ---- package install -------------------------------------------------------
if command -v apt-get >/dev/null 2>&1; then
	FILE="GitStudio-${VERSION}-amd64.deb"
	say "Debian/Ubuntu detected — fetching ${FILE}"
	fetch "${BASE}/${FILE}" "${TMP}/${FILE}"
	say "installing"
	$SUDO apt-get install -y "${TMP}/${FILE}"
elif command -v dnf >/dev/null 2>&1; then
	FILE="GitStudio-${VERSION}-x86_64.rpm"
	say "Fedora/RHEL detected — fetching ${FILE}"
	fetch "${BASE}/${FILE}" "${TMP}/${FILE}"
	say "installing"
	$SUDO dnf install -y "${TMP}/${FILE}"
elif command -v zypper >/dev/null 2>&1; then
	FILE="GitStudio-${VERSION}-x86_64.rpm"
	say "openSUSE detected — fetching ${FILE}"
	fetch "${BASE}/${FILE}" "${TMP}/${FILE}"
	say "installing"
	$SUDO zypper --non-interactive install --allow-unsigned-rpm "${TMP}/${FILE}"
else
	say "no supported package manager found"
	install_appimage
fi

printf '\n  done — launch GitStudio from your applications menu, or run:  gitstudio\n\n'
