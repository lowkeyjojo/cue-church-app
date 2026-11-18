#!/usr/bin/env bash
# Installs Cue on a Mac:
#
#   curl -fsSL https://raw.githubusercontent.com/lowkeyjojo/cue-church-app/main/install.sh | bash
#
# It downloads the newest Cue-mac.dmg from the Releases page, checks it against
# the published SHA-256, copies Cue into Applications and opens it. Run it
# again to get a newer version. It changes no security settings.
#
# For testing:
#   CUE_INSTALL_FROM=<folder>   use the Cue-mac.dmg and SHA256SUMS.txt in it instead of downloading
#   CUE_INSTALL_DIR=<folder>    install there instead of Applications
#   CUE_INSTALL_NO_LAUNCH=1     don't open Cue afterwards
# The checksum is always checked.
#
# Written for the bash 3.2 that macOS ships.
set -euo pipefail

BASE_URL='https://github.com/lowkeyjojo/cue-church-app/releases/latest/download'
DMG='Cue-mac.dmg'
SUMS='SHA256SUMS.txt'
HELP='https://github.com/lowkeyjojo/cue-church-app#install'

WORK=''
MOUNT=''

say() {
  printf '%s\n' "$*"
}

fail() {
  printf 'Cue was not installed: %s\n' "$*" >&2
  exit 1
}

cleanup() {
  if [ -n "$MOUNT" ]; then hdiutil detach "$MOUNT" -quiet >/dev/null 2>&1 || true; fi
  if [ -n "$WORK" ]; then rm -rf "$WORK"; fi
}

# sha256_of FILE: prints the file's SHA-256 in lower-case hex.
sha256_of() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{ print tolower($1) }'
  else
    sha256sum "$1" | awk '{ print tolower($1) }'
  fi
}

# expected_sha256 SUMS NAME: prints the checksum SUMS lists for NAME
# (lines look like "<hash>  <name>" or "<hash> *<name>").
expected_sha256() {
  awk -v name="$2" '
    {
      sub(/\r$/, "")
      file = $2
      sub(/^\*/, "", file)
      if (file == name) {
        print tolower($1)
        exit
      }
    }
  ' "$1"
}

# verify_sha256 FILE SUMS NAME: succeeds only when FILE's SHA-256 is the one SUMS lists for NAME.
verify_sha256() {
  local expected actual
  expected=$(expected_sha256 "$2" "$3")
  [ "${#expected}" -eq 64 ] || return 1
  case "$expected" in
    *[!0-9a-f]*) return 1 ;;
  esac
  actual=$(sha256_of "$1")
  [ "$actual" = "$expected" ]
}

main() {
  local dmg sums dest downloaded waited version

  if [ "$(uname -s)" != 'Darwin' ]; then
    fail "this installer is for macOS. For Windows, see $HELP"
  fi

  WORK=$(mktemp -d "${TMPDIR:-/tmp}/cue-install.XXXXXX")
  trap cleanup EXIT

  downloaded=0
  if [ -n "${CUE_INSTALL_FROM:-}" ]; then
    dmg="$CUE_INSTALL_FROM/$DMG"
    sums="$CUE_INSTALL_FROM/$SUMS"
    if [ ! -f "$dmg" ] || [ ! -f "$sums" ]; then
      fail "$CUE_INSTALL_FROM needs both $DMG and $SUMS"
    fi
    say "Using $dmg"
  else
    dmg="$WORK/$DMG"
    sums="$WORK/$SUMS"
    say 'Downloading Cue...'
    # https only, redirects included.
    if ! curl -fsL --proto '=https' --tlsv1.2 -o "$sums" "$BASE_URL/$SUMS" ||
      ! curl -fL --proto '=https' --tlsv1.2 --progress-bar -o "$dmg" "$BASE_URL/$DMG"; then
      fail "the download didn't finish. Check the internet connection and run this again."
    fi
    downloaded=1
  fi

  say 'Checking the download...'
  if ! verify_sha256 "$dmg" "$sums" "$DMG"; then
    if [ "$downloaded" -eq 1 ]; then rm -f "$dmg"; fi
    fail "$DMG doesn't match its published checksum, so it was not opened. Run this again; if it keeps happening, see $HELP"
  fi

  mkdir "$WORK/mount"
  if ! hdiutil attach "$dmg" -nobrowse -readonly -mountpoint "$WORK/mount" </dev/null >/dev/null; then
    fail "macOS couldn't open the disk image."
  fi
  MOUNT="$WORK/mount"
  if [ ! -d "$MOUNT/Cue.app" ]; then
    fail "the disk image has no Cue in it."
  fi

  dest="${CUE_INSTALL_DIR:-}"
  if [ -z "$dest" ]; then
    if [ -w /Applications ]; then dest='/Applications'; else dest="$HOME/Applications"; fi
  fi
  mkdir -p "$dest" || fail "couldn't create $dest."

  # A Cue that is open is asked to quit, the way its own menu would; it is never forced.
  if pgrep -x Cue >/dev/null 2>&1; then
    say 'Closing Cue...'
    osascript -e 'quit app "Cue"' >/dev/null 2>&1 || true
    waited=0
    while pgrep -x Cue >/dev/null 2>&1; do
      waited=$((waited + 1))
      if [ "$waited" -gt 20 ]; then
        fail 'Cue is still open. Close it, then run this again.'
      fi
      sleep 1
    done
  fi

  say "Installing Cue in $dest..."
  # Copied next to the old one first, so a copy that fails leaves the Cue that was there.
  rm -rf "$dest/.Cue.app.installing"
  if ! cp -R "$MOUNT/Cue.app" "$dest/.Cue.app.installing"; then
    rm -rf "$dest/.Cue.app.installing"
    fail "couldn't copy Cue into $dest."
  fi
  rm -rf "$dest/Cue.app"
  mv "$dest/.Cue.app.installing" "$dest/Cue.app"

  hdiutil detach "$MOUNT" -quiet >/dev/null 2>&1 || true
  MOUNT=''

  version=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$dest/Cue.app/Contents/Info.plist" 2>/dev/null || true)
  if [ "${CUE_INSTALL_NO_LAUNCH:-}" = '1' ]; then
    say "Cue $version is installed in $dest."
  else
    open "$dest/Cue.app"
    say "Cue $version is installed in $dest and is opening."
  fi
}

# Run only when executed (also through "curl ... | bash"); sourcing it just defines the functions.
if ! (return 0 2>/dev/null); then
  main
fi
