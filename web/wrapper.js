// The web counterpart of Magic's Tcl/Tk wrapper (tcltk/wrapper.tcl and
// tcltk/toolbar.tcl): every layout window gets the wrapper's menu bar
// (File, Edit, Cell, Window, Layers, Drc, Options), its title bar with the
// DRC switch, caption, message and coordinates, the layer toolbar, and an
// optional command entry.  The managers opened from the Options menu live
// in managers.js.

import {menuBar} from "./menu.js";
import {ask} from "./dialog.js";
import {CellManager, LibraryManager, TechManager, DrcManager} from "./managers.js";

const STYLES = `
.mw-frame { display: flex; flex-direction: column; height: 100%; }
.mw-titlebar { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 8px; padding: 2px 4px;
  background: var(--magic-bar); color: var(--magic-bar-fg); font-size: 12px; border-bottom: 1px solid var(--rule); }
.mw-titlebar .mb-button { color: var(--magic-bar-fg); }
.mw-titlebar .mb-button:hover, .mw-titlebar .mb-button[aria-expanded="true"] { color: var(--fg); }
.mw-drc { display: flex; align-items: center; gap: 3px; cursor: pointer; }
.mw-caption { flex: 1 1 14em; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.mw-message, .mw-pos { white-space: nowrap; font-family: var(--mono); font-size: 11px; }
.mw-main { position: relative; flex: 1; display: flex; min-height: 0; }
.mw-view { position: relative; flex: 1; min-width: 0; overflow: hidden; }
.mw-toolbar { flex: none; overflow-y: auto; overflow-x: hidden; border-left: 1px solid var(--rule); background: var(--panel);
  font-size: 12px; padding: 2px 0; max-width: 40%; }
.mw-toolbar[hidden] { display: none; }
.mw-layer { display: flex; align-items: center; gap: 5px; padding: 1px 8px 1px 3px; cursor: pointer; user-select: none;
  white-space: nowrap; outline: none; }
.mw-layer:hover, .mw-layer:focus { background: var(--accent-soft); }
.mw-layer canvas { flex: none; width: 16px; height: 16px; border: 1px solid var(--rule); }
.mw-layer.dragging { opacity: .4; }
.mw-toolbar.reorder .mw-layer { cursor: grab; }
.mw-cmdentry { display: flex; align-items: center; gap: 4px; padding: 3px 4px; border-top: 1px solid var(--rule); }
.mw-cmdentry[hidden] { display: none; }
.mw-cmdentry input { flex: 1; min-width: 0; font: 12px var(--mono); color: inherit; background: var(--log-bg);
  border: 1px solid var(--rule); border-radius: 4px; padding: 2px 5px; }
`;

const ICON_SIZE = 16;
const GRID_STEPS = ["0.05um", "0.10um", "0.50um", "1.00um", "5.00um", "10.0um"];

// Parse the tab-separated records that the magic_web_* queries return.
export function records(text) {
    return text.split("\n").filter(Boolean).map(line => line.split("\t"));
}

function signed(value) {
    return /^-/.test(value) ? value : "+" + value;
}

export class Gui {
    constructor(app) {
        this.app = app;
        this.frames = new Map();       // wid -> LayoutFrame
        this.icons = new Map();        // "layer|pale|dpr" -> canvas
        this.tech = "";
        this.opts = {hidelocked: false, crosshair: false, printunits: false, drc: true, reorder: false};
        this.managers = {};
        if(!document.getElementById("mw-styles")) {
            const style = document.createElement("style");
            style.id = "mw-styles";
            style.textContent = STYLES;
            document.head.appendChild(style);
        }
    }

    // Called by the canvas driver for every new Magic window; returns the canvas's host element.
    decorate(win) {
        if(win.client !== "layout") {
            return null;
        }
        const frame = new LayoutFrame(this, win);
        this.frames.set(win.wid, frame);
        return frame.view;
    }

    forget(wid) {
        this.frames.delete(wid);
    }

    // The windows of a given Magic client ("layout", "color", "netlist").
    windowsOf(client) {
        return [...this.app.driver.windows.values()].filter(w => w.client === client);
    }

    // Refresh title bars, toolbars and open managers after Magic ran something.
    scheduleUpdate() {
        if(this.updateQueued) {
            return;
        }
        this.updateQueued = true;
        requestAnimationFrame(() => {
            this.updateQueued = false;
            this.update();
        });
    }

    update() {
        for(const [wid, frame] of this.frames) {
            if(!this.app.driver.windows.has(wid)) {
                this.frames.delete(wid);
                continue;
            }
            frame.update();
        }
        for(const manager of Object.values(this.managers)) {
            if(manager.isOpen()) {
                manager.refreshIfStale();
            }
        }
    }

    // A layer's toolbar icon, drawn by Magic itself (GrWebLayerIcon) and cached.
    icon(layer, pale) {
        const dpr = window.devicePixelRatio || 1;
        const key = `${layer}|${pale ? 1 : 0}|${dpr}`;
        let canvas = this.icons.get(key);
        if(!canvas) {
            canvas = document.createElement("canvas");
            canvas.width = canvas.height = Math.round(ICON_SIZE * dpr);
            const ctx = canvas.getContext("2d");
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.imageSmoothingEnabled = false;
            const driver = this.app.driver;
            driver.iconTarget = {canvas, ctx, dpr, width: ICON_SIZE, height: ICON_SIZE};
            this.app.query("magic_web_layer_icon", [0, layer, ICON_SIZE, pale ? 1 : 0]);
            driver.iconTarget = null;
            this.icons.set(key, canvas);
        }
        return canvas;
    }

    // Technology changed: icons and toolbars must be rebuilt.
    techChanged(tech) {
        this.tech = tech;
        this.icons.clear();
        for(const frame of this.frames.values()) {
            frame.toolbar.rebuild();
        }
        this.managers.tech?.refresh();
    }

    // The window that the managers act on: the chosen target, else the first layout window.
    target(chosen) {
        const wins = this.windowsOf("layout");
        return wins.find(w => w.wid === chosen) ? chosen : (wins[0] ? wins[0].wid : -1);
    }

    manager(name) {
        const classes = {cell: CellManager, library: LibraryManager, tech: TechManager, drc: DrcManager};
        if(!this.managers[name]) {
            this.managers[name] = new classes[name](this);
        }
        return this.managers[name];
    }

    toggleManager(name) {
        const manager = this.manager(name);
        if(manager.isOpen()) {
            manager.close();
        } else {
            manager.open();
        }
    }

    toggleSpecial(client) {
        const open = this.windowsOf(client);
        if(open.length) {
            for(const w of open) {
                this.app.run(w.wid, "closewindow");
            }
        } else {
            this.app.run(-1, `specialopen ${client}`);
        }
    }

    setCrosshair(on) {
        this.opts.crosshair = on;
        if(!on) {
            this.app.run(-1, "crosshair off", true);
        }
    }

    pointerMoved(win) {
        const frame = this.frames.get(win.wid);
        if(frame) {
            frame.cursorMoved();
        }
    }
}

class LayoutFrame {
    constructor(gui, win) {
        this.gui = gui;
        this.app = gui.app;
        this.win = win;
        this.wid = win.wid;
        this.stack = [];               // Down/Up hierarchy: [{cell, view}]
        this.status = {};
        this.showToolbar = true;
        this.boxText = "";

        const root = document.createElement("div");
        root.className = "mw-frame";
        root.innerHTML = '<div class="mw-titlebar"></div>' +
            '<div class="mw-main"><div class="mw-view"></div><div class="mw-toolbar" role="toolbar" aria-orientation="vertical"></div></div>' +
            '<div class="mw-cmdentry" hidden><label>:</label><input aria-label="Command for this window" spellcheck="false" autocomplete="off"></div>';
        win.fw.body.appendChild(root);
        this.view = root.querySelector(".mw-view");
        const titlebar = root.querySelector(".mw-titlebar");

        titlebar.appendChild(menuBar(this.menus(), "Magic window menu",
            {onDone: () => this.win.canvas.focus({preventScroll: true})}));
        const drc = document.createElement("label");
        drc.className = "mw-drc";
        drc.title = "Background design rule checking";
        drc.innerHTML = '<input type="checkbox" checked> DRC';
        this.drcBox = drc.firstChild;
        this.drcBox.checked = gui.opts.drc;
        this.drcBox.addEventListener("change", () => {
            gui.opts.drc = this.drcBox.checked;
            this.run(gui.opts.drc ? "drc on" : "drc off");
            for(const frame of gui.frames.values()) {
                frame.drcBox.checked = gui.opts.drc;
            }
        });
        titlebar.appendChild(drc);
        this.caption = document.createElement("span");
        this.caption.className = "mw-caption";
        this.message = document.createElement("span");
        this.message.className = "mw-message";
        this.pos = document.createElement("span");
        this.pos.className = "mw-pos";
        titlebar.append(this.caption, this.message, this.pos);

        this.toolbar = new Toolbar(this, root.querySelector(".mw-toolbar"));
        // On a narrow screen the layout needs the room; Options > Toolbar brings it back.
        if(gui.app.driver.desktop.clientWidth < 700) {
            this.showToolbar = false;
            this.toolbar.element.hidden = true;
        }

        this.cmdentry = root.querySelector(".mw-cmdentry");
        const input = this.cmdentry.querySelector("input");
        input.addEventListener("keydown", event => {
            if(event.key === "Enter" && input.value.trim()) {
                this.run(input.value.trim(), false);
                input.value = "";
            }
        });
    }

    run(command, quiet = true) {
        return this.app.run(this.wid, command, quiet);
    }

    setMessage(text) {
        this.message.textContent = text;
    }

    // ----- Title bar

    update() {
        const status = Object.fromEntries(records(this.app.query("magic_web_status", [this.wid])));
        this.status = status;
        const caption = status.caption || "";
        const m = /^(\S+)\s+EDITING\s+(\S+)/.exec(caption);
        const loaded = m ? m[1] : caption.split(/\s+/)[0] || "none";
        const editing = m ? m[2] : caption;
        this.caption.textContent = `Loaded: ${loaded}  Editing: ${editing}  Tool: ${status.tool || "box"}  Technology: ${status.tech || ""}`;
        this.caption.title = this.caption.textContent;
        if(status.tech && status.tech !== this.gui.tech) {
            this.gui.techChanged(status.tech);
        }
        const box = status.box ? status.box.split(" ") : null;
        this.boxText = box ? `box (${signed(box[0])} ${signed(box[1])}) to (${signed(box[2])} ${signed(box[3])})` : "no box";
        if(!this.win.pointer) {
            this.pos.textContent = this.boxText;
        }
        this.toolbar.refresh();
    }

    cursorMoved() {
        if(this.cursorQueued) {
            return;
        }
        this.cursorQueued = true;
        requestAnimationFrame(() => {
            this.cursorQueued = false;
            const p = this.win.pointer;
            if(!p) {
                this.pos.textContent = this.boxText;
                return;
            }
            const [internal, shown, delta] = this.app.query("magic_web_cursor", [this.wid, p.x, p.y]).split("\t");
            if(!shown) {
                return;
            }
            const [x, y] = shown.split(" ");
            let text = `(${signed(x)} ${signed(y)})`;
            if(delta) {
                const [dx, dy] = delta.split(" ");
                text += ` ${signed(dx)} ${signed(dy)}`;
            }
            this.pos.textContent = text;
            if(this.gui.opts.crosshair) {
                const [ix, iy] = internal.split(" ");
                this.run(`crosshair ${ix}i ${iy}i`);
            }
        });
    }

    // ----- Menus (same items as tcltk/wrapper.tcl)

    menus() {
        const app = this.app, gui = this.gui;
        const run = (...commands) => () => {
            for(const command of commands) {
                this.run(command, false);
            }
        };
        const windowCell = () => {
            const m = /^(\S+)/.exec(this.status.caption || "");
            return m ? m[1] : "";
        };

        const file = [
            {label: "Open...", action: () => this.openCell()},
            {label: "Save...", action: () => this.saveCell()},
            "-",
            {label: "Flush changes", action: () => {
                if(window.confirm(`Throw away unsaved changes to ${windowCell()}?`)) {
                    this.run("flush -noprompt", false);
                }
            }},
            "-",
            {label: "Read GDS", action: () => app.readGds(this.wid)},
            {label: "Write GDS", action: () => this.writeGds()},
            "-",
            {label: "Save All", action: run("writeall force")},
            {label: "Download project (.tar.gz)", action: () => app.download()},
        ];

        const edit = [
            {label: "Delete", action: run("delete")},
            "-",
            {label: "Select Area", action: run("select area")},
            {label: "Select Clear", action: run("select clear")},
            "-",
            {label: "Undo", action: run("undo")},
            {label: "Redo", action: run("redo")},
            "-",
            {label: "Rotate 90 degree", action: run("clockwise")},
            {label: "Mirror Up/Down", action: run("upsidedown")},
            {label: "Mirror Left/Right", action: run("sideways")},
            "-",
            {label: "Move Right", action: run("move right 1")},
            {label: "Move Left", action: run("move left 1")},
            {label: "Move Up", action: run("move up 1")},
            {label: "Move Down", action: run("move down 1")},
            "-",
            {label: "Stretch Right", action: run("stretch right 1")},
            {label: "Stretch Left", action: run("stretch left 1")},
            {label: "Stretch Up", action: run("stretch up 1")},
            {label: "Stretch Down", action: run("stretch down 1")},
            "-",
            {label: "Text ...", action: () => this.textHelper()},
        ];

        const cell = [
            {label: "New...", action: async () => {
                const v = await ask({title: "New cell", fields: [{name: "name", label: "Cell name", value: "newcell"}], ok: "Create"});
                if(v && v.name) {
                    this.run(`load ${v.name}`, false);
                }
            }},
            {label: "Save as...", action: () => this.saveCell()},
            {label: "Select", action: run("select cell")},
            {label: "Place Instance", action: async () => {
                const v = await ask({title: "Place instance", message: "Places the cell at the box.",
                    fields: [{name: "name", label: "Cell", list: app.projectCells()}], ok: "Place"});
                if(v && v.name) {
                    this.run(`getcell ${v.name}`, false);
                }
            }},
            "-",
            {label: "Down hierarchy", action: () => this.down()},
            {label: "Up   hierarchy", action: () => this.up()},
            "-",
            {label: "Edit", action: run("edit")},
            "-",
            {label: "Delete", action: () => {
                const name = windowCell();
                if(name && window.confirm(`Delete cell ${name} from memory?`)) {
                    this.run(`cellname delete ${name} -noprompt`, false);
                }
            }},
            "-",
            {label: "Expand Toggle", action: run("expand toggle")},
            {label: "Expand", action: run("expand")},
            {label: "Unexpand", action: run("unexpand")},
            "-",
            {label: "Lock   Cell", action: run("instance lock")},
            {label: "Unlock Cell", action: run("instance unlock")},
        ];

        const windowMenu = () => [
            {label: "Clone", action: () => this.run(`openwindow ${windowCell()}`, false)},
            {label: "New", action: run("openwindow")},
            {label: "Set Editable", action: () => {
                // The Tcl version brackets this with pushbox/popbox.
                const box = this.status.boxi;
                this.run("select top cell", false);
                this.run("edit", false);
                if(box) {
                    this.run(`box ${box.split(" ").map(v => v + "i").join(" ")}`);
                }
            }},
            {label: "Close", action: () => this.win.fw.onClose()},
            "-",
            {label: "Full View", action: run("view")},
            {label: "Redraw", action: run("redraw")},
            {label: "Zoom Out", action: run("zoom 2")},
            {label: "Zoom In", action: run("zoom 0.5")},
            {label: "Zoom Box", action: run("findbox zoom")},
            "-",
            {label: "Grid on", action: run("grid on")},
            {label: "Grid off", action: run("grid off")},
            {label: "Snap-to-grid on", action: run("snap on")},
            {label: "Snap-to-grid off", action: run("snap off")},
            {label: "Measure box", action: run("box")},
            "-",
            {label: "Report internal units", action: run("units internal")},
            {label: "Report lambda units", action: run("units lambda")},
            {label: "Report micron units", action: run("units microns")},
            {label: "Report grid units", action: run("units grid")},
            {label: "Display units", checked: () => gui.opts.printunits, action: () => {
                gui.opts.printunits = !gui.opts.printunits;
                this.run(gui.opts.printunits ? "units print" : "units noprint", false);
            }},
            "-",
            ...GRID_STEPS.map(step => ({label: `Set grid ${step}`, action: run(`grid ${step}`)})),
        ];

        const layers = [
            {label: "Protect Base Layers", action: run("tech revert")},
            {label: "Unlock  Base Layers", action: run("tech unlock *")},
            "-",
            {label: "Clear Feedback", action: run("feedback clear")},
            "-",
            {label: "Reorder layers", checked: () => gui.opts.reorder, action: () => {
                gui.opts.reorder = !gui.opts.reorder;
                for(const frame of gui.frames.values()) {
                    frame.toolbar.setReorder(gui.opts.reorder);
                }
                if(gui.opts.reorder) {
                    app.print("Drag layers in the toolbar to reorder them; choose Layers > Reorder layers again when done.", "info");
                }
            }},
        ];

        const drc = () => {
            const styles = (records(app.query("magic_web_tech", [])).find(r => r[0] === "drc") || []).slice(1);
            const current = styles.shift();
            return [
                {label: "DRC update", action: run("drc check", "drc why")},
                {label: "DRC report", action: run("drc why")},
                {label: "DRC Find next error", action: run("drc find", "findbox zoom")},
                "-",
                ...[...new Set(styles)].map(style => ({label: `DRC style ${style}`, checked: () => style === current,
                    action: run(`drc style ${style}`)})),
            ];
        };

        const options = () => [
            {label: "Toolbar", checked: () => this.showToolbar, action: () => this.toolbar.show(!this.showToolbar)},
            {label: "Toolbar Hide Locked", checked: () => gui.opts.hidelocked, action: () => {
                gui.opts.hidelocked = !gui.opts.hidelocked;
                for(const frame of gui.frames.values()) {
                    frame.toolbar.rebuild();
                }
            }},
            {label: "Cell Manager", checked: () => gui.manager("cell").isOpen(), action: () => gui.toggleManager("cell")},
            {label: "Library Manager", checked: () => gui.manager("library").isOpen(), action: () => gui.toggleManager("library")},
            {label: "Tech Manager", checked: () => gui.manager("tech").isOpen(), action: () => gui.toggleManager("tech")},
            {label: "DRC Manager", checked: () => gui.manager("drc").isOpen(), action: () => gui.toggleManager("drc")},
            {label: "Netlist Window", checked: () => gui.windowsOf("netlist").length > 0, action: () => gui.toggleSpecial("netlist")},
            {label: "Colormap Window", checked: () => gui.windowsOf("color").length > 0, action: () => gui.toggleSpecial("color")},
            {label: "3D Display", disabled: true, title: "Needs OpenGL, which the web build doesn't have"},
            {label: "Window Command Entry", checked: () => !this.cmdentry.hidden, action: () => {
                this.cmdentry.hidden = !this.cmdentry.hidden;
                if(!this.cmdentry.hidden) {
                    this.cmdentry.querySelector("input").focus();
                }
            }},
            {label: "Crosshair", checked: () => gui.opts.crosshair, action: () => gui.setCrosshair(!gui.opts.crosshair)},
        ];

        return [["File", file], ["Edit", edit], ["Cell", cell], ["Window", windowMenu], ["Layers", layers],
            ["Drc", drc], ["Options", options]];
    }

    // ----- Menu actions that need a dialog

    async openCell() {
        const v = await ask({title: "Open cell", message: "A cell in the project, or a new name to create one.",
            fields: [{name: "name", label: "Cell", list: this.app.projectCells()}], ok: "Open"});
        if(v && v.name) {
            this.run(`load ${v.name}`, false);
        }
    }

    async saveCell() {
        const m = /^\S+\s+EDITING\s+(\S+)/.exec(this.status.caption || "");
        const v = await ask({title: "Save cell", fields: [{name: "name", label: "Save the edit cell as", value: m ? m[1] : ""}], ok: "Save"});
        if(v && v.name) {
            this.run(`save ${v.name}`, false);
        }
    }

    async writeGds() {
        const cell = (/^(\S+)/.exec(this.status.caption || "") || [])[1] || "layout";
        const v = await ask({title: "Write GDS", fields: [{name: "name", label: "File name", value: cell + ".gds"}], ok: "Write and download"});
        if(v && v.name) {
            this.run(`gds write ${v.name}`, false);
            this.app.downloadFile(v.name);
        }
    }

    async textHelper() {
        const v = await ask({title: "Text", message: "Puts a label at the box.", fields: [
            {name: "text", label: "Text", value: ""},
            {name: "just", label: "Justification", options: [["", "default"], "center", "n", "ne", "e", "se", "s", "sw", "w", "nw"]},
            {name: "font", label: "Font", options: [["", "default (no font)"], "FreeSans", "FreeSerif", "FreeMono"]},
            {name: "size", label: "Size (with font)", value: "1um"},
            {name: "rotate", label: "Rotation (with font)", options: ["0", "90", "180", "270"]},
            {name: "layer", label: "Layer (optional)", list: this.toolbar.layers.map(l => l.name).slice(3)},
        ], ok: "Apply"});
        if(!v || !v.text) {
            return;
        }
        const text = /\s/.test(v.text) ? `"${v.text.replace(/"/g, "")}"` : v.text;
        let command = `label ${text}`;
        if(v.font) {
            command += ` ${v.font} ${v.size || "1um"} ${v.rotate || 0} 0 0`;
        }
        // Magic reads the word after the text as a font unless a justification comes first.
        if(v.just || v.layer) {
            command += ` ${v.just || "center"}`;
        }
        if(v.layer) {
            command += ` ${v.layer}`;
        }
        this.run(command, false);
    }

    // Down and Up hierarchy (magic::pushstack and popstack in the Tcl wrapper).
    down() {
        const cell = this.status.selcell;
        const root = (/^(\S+)/.exec(this.status.caption || "") || [])[1];
        if(!cell || cell === root) {
            this.app.print("Select a cell instance first (Cell > Select, or the i key).", "error");
            return;
        }
        this.stack.push({cell: root, view: this.status.view});
        this.run(`load ${cell}`, false);
    }

    up() {
        const last = this.stack.pop();
        if(!last) {
            this.app.print("Already at the top of the hierarchy.", "info");
            return;
        }
        this.run(`load ${last.cell}`, false);
        if(last.view) {
            this.run(`view ${last.view.split(" ").map(v => v + "i").join(" ")}`);
        }
    }
}

// The layer toolbar (tcltk/toolbar.tcl): left click shows a layer, right click hides it,
// middle click (or Alt+click) paints it into the box and Shift+middle erases it.  With the
// pointer over a layer: p paints, e erases, s and S add to or remove from the selection,
// l locks and u unlocks.
class Toolbar {
    constructor(frame, element) {
        this.frame = frame;
        this.element = element;
        this.element.setAttribute("aria-label", "Layers");
        this.layers = [];
        this.rows = new Map();
        this.signature = "";
        this.listen();
    }

    show(on) {
        this.frame.showToolbar = on;
        this.element.hidden = !on;
        if(on) {
            this.rebuild();
        }
    }

    setReorder(on) {
        this.element.classList.toggle("reorder", on);
        for(const row of this.rows.values()) {
            row.draggable = on;
        }
    }

    orderKey() {
        return "magic-toolbar:" + this.frame.gui.tech;
    }

    savedOrder() {
        try {
            return JSON.parse(window.localStorage.getItem(this.orderKey())) || [];
        } catch(e) {
            return [];
        }
    }

    saveOrder() {
        try {
            window.localStorage.setItem(this.orderKey(), JSON.stringify([...this.element.children].map(r => r.dataset.layer)));
        } catch(e) {
            // Storage blocked: the order lasts until the page is reloaded.
        }
    }

    query() {
        return records(this.frame.app.query("magic_web_layers", [this.frame.wid]))
            .map(([name, locked, visible]) => ({name, locked: locked === "1", visible: visible === "1"}));
    }

    rebuild() {
        this.signature = "";
        this.rows.clear();
        this.element.textContent = "";
        this.refresh();
    }

    // Rebuild rows when the layer list changes; otherwise just redraw changed icons.
    refresh() {
        if(this.element.hidden) {
            return;
        }
        const gui = this.frame.gui;
        let layers = this.query();
        if(gui.opts.hidelocked) {
            layers = layers.filter(l => !l.locked);
        }
        const order = this.savedOrder();
        if(order.length) {
            const rank = new Map(order.map((name, i) => [name, i]));
            layers.sort((a, b) => (rank.get(a.name) ?? 1e9) - (rank.get(b.name) ?? 1e9));
        }
        const signature = layers.map(l => l.name).join(",");
        if(signature !== this.signature) {
            this.signature = signature;
            this.element.textContent = "";
            this.rows.clear();
            for(const layer of layers) {
                const row = document.createElement("div");
                row.className = "mw-layer";
                row.tabIndex = -1;
                row.dataset.layer = layer.name;
                row.innerHTML = "<canvas></canvas><span></span>";
                row.lastChild.textContent = layer.name;
                row.draggable = gui.opts.reorder;
                this.element.appendChild(row);
                this.rows.set(layer.name, row);
            }
            this.element.classList.toggle("reorder", gui.opts.reorder);
            if(this.rows.size) {
                this.element.firstChild.tabIndex = 0;
            }
        }
        this.layers = layers;
        for(const layer of layers) {
            const row = this.rows.get(layer.name);
            const state = `${layer.locked}|${layer.visible}|${window.devicePixelRatio || 1}`;
            if(row.dataset.state === state) {
                continue;
            }
            row.dataset.state = state;
            const canvas = row.firstChild, dpr = window.devicePixelRatio || 1;
            canvas.width = canvas.height = Math.round(ICON_SIZE * dpr);
            const ctx = canvas.getContext("2d");
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            if(layer.visible) {
                ctx.drawImage(gui.icon(layer.name, layer.locked), 0, 0);
            }
            row.title = layer.name + (layer.locked ? " (locked)" : "") + (layer.visible ? "" : " (hidden)") +
                (layer.locked ? "\nclick: show · right click: hide · u: unlock" :
                    "\nclick: show · right click: hide · middle or Alt+click: paint · Shift+middle: erase" +
                    "\nkeys: p paint · e erase · s/S select more/less · l lock");
            row.setAttribute("aria-label", row.title.split("\n")[0]);
        }
    }

    layerAt(event) {
        const row = event.target.closest(".mw-layer");
        return row ? this.layers.find(l => l.name === row.dataset.layer) : null;
    }

    listen() {
        const el = this.element, frame = this.frame;
        el.addEventListener("contextmenu", event => event.preventDefault());
        el.addEventListener("pointerdown", event => {
            const layer = this.layerAt(event);
            if(!layer || this.element.classList.contains("reorder")) {
                return;
            }
            event.preventDefault();
            event.target.closest(".mw-layer").focus({preventScroll: true});
            const middle = event.button === 1 || (event.button === 0 && event.altKey);
            if(middle && !layer.locked) {
                frame.run(`${event.shiftKey ? "erase" : "paint"} ${layer.name}`, false);
            } else if(event.button === 0) {
                frame.run(`see ${layer.name}`, false);
            } else if(event.button === 2) {
                frame.run(`see no ${layer.name}`, false);
            }
        });
        el.addEventListener("pointerover", event => {
            const layer = this.layerAt(event);
            frame.setMessage(layer ? layer.name + (layer.locked ? " (locked)" : "") : "");
        });
        el.addEventListener("pointerleave", () => {
            frame.setMessage("");
            // Focus followed the pointer into the toolbar; give the keys back to the layout.
            if(el.contains(document.activeElement)) {
                frame.win.canvas.focus({preventScroll: true});
            }
        });
        el.addEventListener("keydown", event => {
            const layer = this.layerAt(event);
            if(!layer) {
                return;
            }
            const rows = [...el.children], i = rows.indexOf(event.target);
            if(event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                rows[Math.max(0, Math.min(rows.length - 1, i + (event.key === "ArrowDown" ? 1 : -1)))]?.focus();
                return;
            }
            const commands = layer.locked ? {u: `tech unlock ${layer.name}`} : {
                p: `paint ${layer.name}`, e: `erase ${layer.name}`, s: `select more area ${layer.name}`,
                S: `select less area ${layer.name}`, l: `tech lock ${layer.name}`,
            };
            if(event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                frame.run(`see ${layer.visible ? "no " : ""}${layer.name}`, false);
            } else if(commands[event.key]) {
                event.preventDefault();
                frame.run(commands[event.key], false);
            }
        });
        // Focus follows the pointer, as in Tk, so the keys work without clicking first.
        el.addEventListener("pointermove", event => {
            const row = event.target.closest(".mw-layer");
            if(row && document.activeElement !== row && !document.activeElement?.matches("input, select, textarea")) {
                row.focus({preventScroll: true});
            }
        });

        // Reorder by dragging (Layers > Reorder layers).
        let dragged = null;
        el.addEventListener("dragstart", event => {
            dragged = event.target.closest(".mw-layer");
            dragged?.classList.add("dragging");
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", dragged?.dataset.layer || "");
        });
        el.addEventListener("dragover", event => {
            if(!dragged) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            const row = event.target.closest(".mw-layer");
            if(row && row !== dragged) {
                const r = row.getBoundingClientRect();
                el.insertBefore(dragged, event.clientY < r.top + r.height / 2 ? row : row.nextSibling);
            }
        });
        el.addEventListener("drop", event => {
            if(dragged) {
                event.preventDefault();
                event.stopPropagation();
            }
        });
        el.addEventListener("dragend", () => {
            if(dragged) {
                dragged.classList.remove("dragging");
                dragged = null;
                this.saveOrder();
                for(const other of frame.gui.frames.values()) {
                    if(other.toolbar !== this) {
                        other.toolbar.rebuild();
                    }
                }
            }
        });
    }
}
