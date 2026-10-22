#!/usr/bin/env bash
# Build Magic for the browser (WEB graphics driver) and copy the result
# next to the web app at the top of the repository; the source is in src/.
#
# Usage:  ./build.sh [--debug]
#
# Needs Emscripten: either emcc on PATH, or EMSDK_DIR pointing at an emsdk
# checkout.  The build runs out of source in build-web/ (WEB_BUILD_DIR).

set -euo pipefail

WEB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_DIR="$WEB_DIR/src"
BUILD_DIR="${WEB_BUILD_DIR:-$WEB_DIR/build-web}"

OPT_FLAGS="-O2"
for arg in "$@"; do
  case "$arg" in
    --debug) OPT_FLAGS="-g" ;;
    *) echo "Unknown option: $arg" >&2; exit 1 ;;
  esac
done

if [ -n "${EMSDK_DIR:-}" ]; then
  # shellcheck source=/dev/null
  source "$EMSDK_DIR/emsdk_env.sh" >/dev/null
fi
command -v emcc >/dev/null || { echo "emcc not found (set EMSDK_DIR)" >&2; exit 1; }
emcc --version | head -1

mkdir -p "$BUILD_DIR"
cd "$BUILD_DIR"

# Configure once; later runs rebuild incrementally.
if [ ! -f defs.mak ]; then
  CFLAGS="--std=c17 -D_DEFAULT_SOURCE=1 -DEMSCRIPTEN=1 $OPT_FLAGS" \
    emconfigure "$SRC_DIR/configure" \
      --without-cairo --without-opengl --without-x \
      --without-tk --without-tcl \
      --disable-readline --disable-compression \
      --host=asmjs-unknown-emscripten \
      --target=asmjs-unknown-emscripten
  cat "$SRC_DIR/toolchains/emscripten/defs.mak" >> defs.mak
  emmake make MAGIC_WEB=1 depend
fi

emmake make MAGIC_WEB=1 -j"$(nproc)" modules libs
emmake make MAGIC_WEB=1 techs
rm -f magic/magic.js magic/magic.wasm
emmake make MAGIC_WEB=1 mains

cp magic/magic.js magic/magic.wasm "$WEB_DIR/"

# The system startup file, with the X11 key macros (arrows, keypad,
# scroll wheel) that the WEB driver supports.
python3 "$SRC_DIR/scripts/preproc.py" -ccomm -DXLIB -DUSE_NEW_MACROS \
  "$SRC_DIR/magic/proto.magicrc.in" > "$WEB_DIR/magicrc"

ls -l "$WEB_DIR/magic.js" "$WEB_DIR/magic.wasm" "$WEB_DIR/magicrc"
