# Magic in the browser

An interactive build of Magic for the web: Magic compiled to WebAssembly with a
new graphics driver (`graphics/grWeb.c`) that draws each Magic window on an
HTML canvas inside a movable, resizable, collapsible window on the page.

## Build and run

    git submodule update --init irsim          # IRSIM, for the simulator commands

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
| `web/storage.js` | Keeping projects: a real folder (File System Access API) or the browser's IndexedDB, and the recent-projects list. |
| `web/archive.js` | .zip / .tar / .tar.gz reading and .tar.gz writing with the browser's (De)CompressionStream. |
| `web/wrapper.js` | The Tcl/Tk wrapper's per-window GUI (`tcltk/wrapper.tcl`, `toolbar.tcl`): File, Edit, Cell, Window, Layers, Drc and Options menus, the DRC switch, caption and coordinates, the layer toolbar and the window command entry. |
| `web/managers.js` | The cell, library, technology and DRC managers from the Options menu (`cellmgr.tcl`, `libmgr.tcl`, `drcmgr.tcl`). |
| `web/menu.js`, `web/dialog.js` | Drop-down menus and the prompt dialogs. |
| `sim/SimRsim.c` | Magic's simulator interface. Under `MAGIC_WEB` the process and its two pipes are replaced by calls to `Module.magicRsim` (start, write, read, stop), and the `rsim` prompt loop by `magic_web_rsim_line`, one line at a time. |
| `web/rsim.js` | That bridge: runs IRSIM from the `irsim` submodule (`../irsim/web/irsim.js`) as a second WebAssembly module, loaded on first use and dropped on `q`. |
| `web/simulation.js` | The Tcl integration's `irsim`, `watchnode`, `unwatchnode` and `watchtime`, and the IRSIM app's analyzer and node lists fed from the same simulator. |
| `web/app.js` | Page logic: console, command line, project loading, download, demos. |

## Using it

- Mouse: left and right set the box corners, middle (or Alt+left) paints,
  the wheel scrolls, Ctrl+wheel zooms. Keys are Magic's default macros.
- `:` (or `;`) moves to the command line below the windows.
- Project > Open files (.mag, .gds, .tech), Open folder, or one .zip/.tar/.tar.gz
  archive, or drop them on the page: the files are copied into memory. The
  cell no other cell uses is opened. Download project runs `writeall force`
  and saves the project as .tar.gz.
- To keep a project between visits:
  - **Work in a folder on disk** (Chromium browsers): pick a folder; every
    file Magic writes (save, writeall, extract, gds write) is copied into it
    about a third of a second later. Save project to a folder does the same
    for the project already open.
  - **Keep project in browser storage** (any browser): the same, into
    IndexedDB, private to the site. The page asks the browser to keep it
    (`navigator.storage.persist()`).
  - Both appear under Project > Reopen next time; a folder asks for
    permission again with one click. Folders skip `.git`, `node_modules` and
    files over 64 MB when read.
- Controls used with the mouse hand the keyboard back to the layout window,
  so Magic's keys (space, letters) never press them again; with nothing
  focused, keys go to the active layout window.
- Each layout window has the Tcl wrapper's menus and layer toolbar. In the
  toolbar, click shows a layer, right click hides it, middle click (or
  Alt+click) paints it and Shift+middle erases it; with the pointer on a
  layer, p, e, s, S, l and u paint, erase, select more or less, lock and
  unlock. The toolbar order (Layers > Reorder layers) is kept per technology
  in the browser.
- Simulation: `irsim [prm] [cell]` extracts and runs `ext2sim` if there is
  no .sim yet, starts IRSIM (default parameters `scmos100`) and enters its
  `irsim>` prompt; `.` returns to Magic and `q` quits IRSIM. Magic's own
  `rsim`, `startrsim`, `simcmd` and `getnode` and the rsim tool work as on the
  desktop, with node names by transistor position. `watchnode` labels the
  selected node with its value and keeps it up to date. IRSIM's supplies are
  `Vdd` and `Gnd`: a cell labelled `VDD`/`GND` needs `h VDD` and `l GND` first.
  Files named on the IRSIM command line are copied from the project folder.
- The default demo is a mirror full adder exported from Stixu and sized for
  speed; `?demo=NAME` picks another file from `demo/`.

## Notes

- The link uses `-sEMULATE_FUNCTION_POINTER_CASTS=1`. Magic calls many
  callbacks through pointers whose declared signatures don't match the
  functions (harmless natively, a trap in WebAssembly). Two such bugs on the
  drawing path are fixed in the source (`dbwind/DBWhlights.c`, netmenu); the
  flag covers the rest.
- The magic_web_* queries in `magic/magicWeb.c` (layers, status, cursor,
  hierarchy, tech, DRC list) replace what the Tcl wrapper reads through Tcl.
- Not available: the 3D window (needs OpenGL) and anything that runs Tcl.
- Interactive macros (`imacro`) and commands that ask a question on the
  terminal fall back to the browser's prompt dialog.
- Files live in Emscripten's in-memory file system until downloaded.
