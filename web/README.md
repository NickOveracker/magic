# Magic in the browser

An interactive build of Magic for the web: Magic compiled to WebAssembly with a
new graphics driver (`graphics/grWeb.c`) that draws each Magic window on an
HTML canvas inside a movable, resizable, collapsible window on the page.

## Build and run

    EMSDK_DIR=/path/to/emsdk web/build.sh     # --debug for a -g build
    python3 -m http.server                     # from the repository root
    # open http://localhost:8000/web/

`build.sh` configures a non-Tcl Emscripten build in `build-web/` with
`MAGIC_WEB=1` (see `toolchains/emscripten/defs.mak`) and copies `magic.js`,
`magic.wasm` and the startup macros (`magicrc`) into this folder.

## How it fits together

| Piece | Role |
| --- | --- |
| `graphics/grWeb.c` | The WEB display type (`magic -d WEB`). Follows the X11 driver's one-surface-per-window model and forwards drawing to `Module.magicWeb`. Uses the OpenGL display styles, so layers are translucent as in the Cairo driver. |
| `magic/magicWeb.c` | Exported entry points: `magic_web_init`, `magic_web_button`, `magic_web_key`, `magic_web_pump`, `magic_web_command`, `magic_web_drc_step`, `magic_web_configure`, ... Nothing blocks; the page owns the event loop. |
| `textio/txCommands.c` | `TxDispatchPending()`: the non-blocking counterpart of `TxDispatch`. |
| `drc/DRCcontin.c` | Background DRC yields after each time slice (`MagicWebShouldYield`). |
| `utils/macros.c` | X11-style extended macros (`XK_Left`, `Control_XK_...`, scroll wheel) without Xlib. |
| `web/canvas-driver.js` | Canvas drawing, stipples, cursors; mouse, wheel and keys translated to X11 keysyms. |
| `web/archive.js` | .zip / .tar / .tar.gz reading and .tar.gz writing with the browser's (De)CompressionStream. |
| `web/app.js` | Page logic: console, command line, project loading, download, demos. |

## Using it

- Mouse: left and right set the box corners, middle (or Alt+left) paints,
  the wheel scrolls, Ctrl+wheel zooms. Keys are Magic's default macros.
- `:` (or `;`) moves to the command line below the windows.
- Open files (.mag, .gds, .tech), a folder, or one .zip/.tar/.tar.gz archive, or drop
  them on the page. The cell no other cell uses is opened. **Download** runs
  `writeall force` and saves the project as .tar.gz.
- The default demo is a 4x4 multiplier exported from Stixu; `?demo=NAME`
  picks another file from `demo/`.

## Notes

- The link uses `-sEMULATE_FUNCTION_POINTER_CASTS=1`. Magic calls many
  callbacks through pointers whose declared signatures don't match the
  functions (harmless natively, a trap in WebAssembly). Two such bugs on the
  drawing path are fixed in the source (`dbwind/DBWhlights.c`, netmenu); the
  flag covers the rest.
- Interactive macros (`imacro`) and commands that ask a question on the
  terminal fall back to the browser's prompt dialog.
- Files live in Emscripten's in-memory file system until downloaded.
