# Magic in the browser

An interactive build of Magic for the web: Magic compiled to WebAssembly with a
new graphics driver (`src/graphics/grWeb.c`) that draws each Magic window on an
HTML canvas inside a movable, resizable, collapsible window on the page.

The app is at https://magic.stixu.io/ and is what this folder
holds; Magic's own source, with its original README and native build, is in
`src/`. The old addresses, nickoveracker.github.io/magic/ and `/web/`,
redirect there.

## Build and run

    git submodule update --init irsim netgen   # IRSIM for the simulator commands, netgen for lvs
    EMSDK_DIR=/path/to/emsdk ./build.sh        # --debug for a -g build
    python3 -m http.server                     # from the repository root
    # open http://localhost:8000/

`build.sh` configures a non-Tcl Emscripten build of `src/` in `build-web/`
with `MAGIC_WEB=1` (see `src/toolchains/emscripten/defs.mak`) and copies
`magic.js`, `magic.wasm` and the startup macros (`magicrc`) into this folder.

## How it fits together

| Piece | Role |
| --- | --- |
| `src/graphics/grWeb.c` | The WEB display type (`magic -d WEB`). Follows the X11 driver's one-surface-per-window model and forwards drawing to `Module.magicWeb`. Uses the OpenGL display styles, so layers are translucent as in the Cairo driver. |
| `src/magic/magicWeb.c` | Exported entry points: `magic_web_init`, `magic_web_button`, `magic_web_key`, `magic_web_pump`, `magic_web_command`, `magic_web_drc_step`, `magic_web_configure`, ... Nothing blocks; the page owns the event loop. |
| `src/textio/txCommands.c` | `TxDispatchPending()`: the non-blocking counterpart of `TxDispatch`. |
| `src/drc/DRCcontin.c` | Background DRC yields after each time slice (`MagicWebShouldYield`). |
| `src/utils/macros.c` | X11-style extended macros (`XK_Left`, `Control_XK_...`, scroll wheel) without Xlib. |
| `canvas-driver.js` | Canvas drawing, stipples, cursors; mouse, wheel and keys translated to X11 keysyms. |
| `storage.js` | Keeping projects: a real folder (File System Access API) or the browser's IndexedDB, and the recent-projects list. |
| `archive.js` | .zip / .tar / .tar.gz reading and .tar.gz writing with the browser's (De)CompressionStream. |
| `wrapper.js` | The Tcl/Tk wrapper's per-window GUI (`src/tcltk/wrapper.tcl`, `toolbar.tcl`): File, Edit, Cell, Window, Layers, Drc and Options menus, the DRC switch, caption and coordinates, the layer toolbar and the window command entry. |
| `managers.js` | The cell, library, technology and DRC managers from the Options menu (`cellmgr.tcl`, `libmgr.tcl`, `drcmgr.tcl`). |
| `menu.js`, `dialog.js` | Drop-down menus and the prompt dialogs. |
| `src/sim/SimRsim.c` | Magic's simulator interface. Under `MAGIC_WEB` the process and its two pipes are replaced by calls to `Module.magicRsim` (start, write, read, stop), and the `rsim` prompt loop by `magic_web_rsim_line`, one line at a time. |
| `rsim.js` | That bridge: runs IRSIM from the `irsim` submodule (`irsim/irsim.js`) as a second WebAssembly module, loaded on first use and dropped on `q`. |
| `lvs.js` | The page's `lvs` command: extract with `ext2spice lvs`, then compare with a schematic using netgen from the `netgen` submodule (its `session.js` and `lvs.js`, which also gives the Result window), loaded on first use. |
| `simulation.js` | The Tcl integration's `irsim`, `watchnode`, `unwatchnode` and `watchtime`, and the IRSIM app's analyzer and node lists fed from the same simulator. |
| `app.js` | Page logic: console, command line, project loading, download, demos. |

## Using it

- Mouse: left and right set the box corners, middle (or Alt+left) paints,
  the wheel scrolls, Ctrl+wheel zooms. Keys are Magic's default macros.
- `:` (or `;`) moves to the command line below the windows.
- Project > Add files to project copies files into the open project: a schematic
  netlist for `lvs`, a setup file, an IRSIM command file.
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
- LVS: `lvs [schematic [cell [setup]]]` extracts the window's cell (`extract all`,
  `ext2spice lvs`, `ext2spice`) and compares the netlist with a schematic in the
  project, using netgen from the `netgen` submodule in its own Web Worker. By
  default the schematic is the project's netlist with "sch" in its name, its cell
  the subcircuit named like the layout's, and the setup the project's
  `*setup*.tcl` or netgen's built-in one for scmos. The report goes into the
  project as `comp.out` and `comp.json`, and netgen's Result window shows it.
  Options > LVS against a Schematic does the same with a dialog. The demo cells'
  labels are ports, and each demo has its schematic in `demo/` (written from the
  layout's netlist, with the p-transistors' bodies on VDD): Stixu's layouts have
  no n-well contacts, so LVS reports their floating wells; the
  `inverter_tap` demo has a contact and matches.
- The default demo is a mirror full adder exported from Stixu and sized for
  speed; `?demo=NAME` picks another file from `demo/`.
- Two demos come from elsewhere, each in a folder with a README: `demo/tut11a/`,
  the 4-bit counter from Magic's tutorial 11 (`irsim`, then `@ counter.cmd`,
  resets it and counts), and `demo/openram/`, four of OpenRAM's cells with its
  SCN4M_SUBM technology file, schematics and netgen setup (`lvs` matches each;
  `irsim tsmc35.20.n98t.3.3 dff`, then `@ dff.cmd`, clocks the flip-flop).
- Options > Open in the IRSIM App and Open in the netgen App extract the
  window's cell and open the IRSIM or netgen web app in a new tab with it
  (`handoff.js`): IRSIM gets `<cell>.sim` and the project's `.cmd` and `.prm`
  files (it runs `<cell>.cmd`, with the parameters IRSIM last started with
  here), netgen the layout's netlist, the schematic and the setup that `lvs`
  would choose, and compares them. The files go from tab to tab in the
  browser; on stixu.io the apps are their own sites (irsim.stixu.io,
  netgen.stixu.io), elsewhere the submodules' copies next to this page.

## Notes

- The link uses `-sEMULATE_FUNCTION_POINTER_CASTS=1`. Magic calls many
  callbacks through pointers whose declared signatures don't match the
  functions (harmless natively, a trap in WebAssembly). Two such bugs on the
  drawing path are fixed in the source (`src/dbwind/DBWhlights.c`, netmenu); the
  flag covers the rest.
- The magic_web_* queries in `src/magic/magicWeb.c` (layers, status, cursor,
  hierarchy, tech, DRC list) replace what the Tcl wrapper reads through Tcl.
- Not available: the 3D window (needs OpenGL) and anything that runs Tcl.
- Interactive macros (`imacro`) and commands that ask a question on the
  terminal fall back to the browser's prompt dialog.
- Files live in Emscripten's in-memory file system until downloaded.

## Licences

Magic is under its own licence, in `LICENSE` (Copyright 1985, 1990 Regents of the University of California).
Magic's files that this fork changed stay under it; each says so in a notice listing its changes and their dates.

The web build's new code is under the GNU General Public License, version 2 or (at your option) any later version
(`licenses/GPL-2.0.txt`): the web app at the top of the repository (HTML, JavaScript, CSS, `build.sh`), the demo
cells in `demo/` (but not the files from Magic's tutorial in `demo/tut11a/`, which are under Magic's licence, or
OpenRAM's in `demo/openram/`, under OpenRAM's BSD licence: their README.txt says which are which), and the new C files `src/graphics/grWeb.c` and `src/magic/magicWeb.c`. Magic's licence allows
combining it with GPL code, so `magic.js` and `magic.wasm`, which contain both, are distributed as a whole under the GPL;
the page shows Magic's copyright, the absence of warranty and the terms for redistribution in its console when it
starts.

The `irsim` submodule is IRSIM, under the GNU General Public License, version 2 (its `COPYRIGHT`), with its own
notices; the page loads it as a separate WebAssembly module when a simulator command first needs it, and shows
IRSIM's notice then. The `netgen` submodule is netgen, under the GNU General Public License (its `Copying`; the
fork's new code under version 2 or later), with Tcl inside its module (its `licenses/`); the page loads it when `lvs`
is first used, and shows netgen's notice then. `magic.js`, `magic.wasm` and IRSIM's module contain the Emscripten runtime, under the licence in
`licenses/emscripten-LICENSE`.
