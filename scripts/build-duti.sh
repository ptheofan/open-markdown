#!/usr/bin/env bash
# Rebuilds resources/bin/duti from upstream source as a universal binary
# (arm64 + x86_64) that runs on the app's minimum macOS.
#
# The packaged app ships this one file for every macOS build: the Mac App
# Store universal build and the separate arm64 / x64 direct downloads. A
# Homebrew copy is not a substitute, since it is built for the host's
# architecture and macOS version only.
#
# Usage: scripts/build-duti.sh
set -euo pipefail

DUTI_REPO="https://github.com/moretension/duti.git"
DUTI_COMMIT="ca8aa7ecefbe5a803bbe55003d648b4688447dd4" # "Bump version to 1.5.4"
DUTI_VERSION="1.5.4"
# Keep in step with LSMinimumSystemVersion in forge.config.ts.
MIN_MACOS="12.0"

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
out="${repo_root}/resources/bin/duti"
work="$(mktemp -d)"
trap 'rm -rf "${work}"' EXIT

git clone --quiet "${DUTI_REPO}" "${work}/duti"
git -C "${work}/duti" checkout --quiet "${DUTI_COMMIT}"

cd "${work}/duti"
sed "s/@PACKAGE_VERSION@/${DUTI_VERSION}/" version.c.in > version.c

# duti uses the UTType C API, deprecated (not removed) since macOS 12.
clang -O2 -Wno-deprecated-declarations \
  -arch arm64 -arch x86_64 \
  -mmacosx-version-min="${MIN_MACOS}" \
  -framework ApplicationServices -framework CoreFoundation \
  -o duti \
  version.c util.c plist.c handler.c duti.c

mkdir -p "$(dirname "${out}")"
install -m 0555 duti "${out}"

lipo -info "${out}"
"${out}" -V
