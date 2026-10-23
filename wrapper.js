// SPDX-License-Identifier: GPL-2.0-or-later
// The web counterpart of Magic's Tcl/Tk wrapper (tcltk/wrapper.tcl and
// tcltk/toolbar.tcl): every layout window gets the wrapper's menu bar
// (File, Edit, Cell, Window, Layers, Drc, Options), its title bar with the
// DRC switch, caption, message and coordinates, the layer toolbar, and an
// optional command entry.  The managers opened from the Options menu live
// in managers.js.

import {menuBar} from "./menu.js";
import {ask} from "./dialog.js";
import {CellManager, LibraryManager, TechManager, DrcManager} from "./managers.js";
import {t, register, applyStatic} from "./i18n.js";

// The window's text in Japanese (i18n.js).  Menu items that are Magic's own words (DRC, Drc)
// and Magic's commands, layer and cell names stay as they are.
register({
    // Menu titles
    "Magic window menu": "Magic ウィンドウのメニュー",
    "File": "ファイル",
    "Edit": "編集",
    "Cell": "セル",
    "Window": "ウィンドウ",
    "Layers": "レイヤー",
    "Options": "オプション",
    // File
    "Open...": "開く…",
    "Save...": "保存…",
    "Flush changes": "変更を破棄",
    "Read GDS": "GDS を読み込む",
    "Write GDS": "GDS を書き出す",
    "Save All": "すべて保存",
    "Download project (.tar.gz)": "プロジェクトをダウンロード（.tar.gz）",
    "Throw away unsaved changes to {cell}?": "{cell} の保存していない変更を破棄しますか？",
    // Edit
    "Delete": "削除",
    "Select Area": "領域を選択",
    "Select Clear": "選択を解除",
    "Undo": "元に戻す",
    "Redo": "やり直し",
    "Rotate 90 degree": "90 度回転",
    "Mirror Up/Down": "上下反転",
    "Mirror Left/Right": "左右反転",
    "Move Right": "右へ移動",
    "Move Left": "左へ移動",
    "Move Up": "上へ移動",
    "Move Down": "下へ移動",
    "Stretch Right": "右へ引き伸ばし",
    "Stretch Left": "左へ引き伸ばし",
    "Stretch Up": "上へ引き伸ばし",
    "Stretch Down": "下へ引き伸ばし",
    "Text ...": "テキスト…",
    // Cell
    "New...": "新規…",
    "Save as...": "名前を付けて保存…",
    "Select": "選択",
    "Place Instance": "インスタンスを配置",
    "Down hierarchy": "階層を下りる",
    "Up   hierarchy": "階層を上る",
    "Expand Toggle": "展開を切り替え",
    "Expand": "展開",
    "Unexpand": "展開を解除",
    "Lock   Cell": "セルをロック",
    "Unlock Cell": "セルのロックを解除",
    "Delete cell {name} from memory?": "セル {name} をメモリから削除しますか？",
    // Window
    "Clone": "複製",
    "New": "新規",
    "Set Editable": "編集可能にする",
    "Close": "閉じる",
    "Full View": "全体表示",
    "Redraw": "再描画",
    "Zoom Out": "縮小",
    "Zoom In": "拡大",
    "Zoom Box": "ボックスを拡大表示",
    "Grid on": "グリッドをオン",
    "Grid off": "グリッドをオフ",
    "Snap-to-grid on": "グリッドへのスナップをオン",
    "Snap-to-grid off": "グリッドへのスナップをオフ",
    "Measure box": "ボックスの寸法",
    "Report internal units": "内部単位で表示",
    "Report lambda units": "lambda 単位で表示",
    "Report micron units": "ミクロン単位で表示",
    "Report grid units": "グリッド単位で表示",
    "Display units": "単位を付けて表示",
    "Set grid {step}": "グリッドを {step} に",
    // Layers
    "Protect Base Layers": "基本レイヤーを保護",
    "Unlock  Base Layers": "基本レイヤーのロックを解除",
    "Clear Feedback": "フィードバックを消去",
    "Reorder layers": "レイヤーの並べ替え",
    "Drag layers in the toolbar to reorder them; choose Layers > Reorder layers again when done.":
        "ツールバーのレイヤーをドラッグして並べ替えます。終わったら、もう一度「レイヤー」>「レイヤーの並べ替え」を選んでください。",
    // Drc
    "DRC update": "DRC を更新",
    "DRC report": "DRC レポート",
    "DRC Find next error": "次の DRC エラーを探す",
    "DRC style {style}": "DRC スタイル {style}",
    // Options
    "Toolbar": "ツールバー",
    "Toolbar Hide Locked": "ツールバーでロック中のレイヤーを隠す",
    "Cell Manager": "セルマネージャー",
    "Library Manager": "ライブラリマネージャー",
    "Tech Manager": "テクノロジーマネージャー",
    "DRC Manager": "DRC マネージャー",
    "Netlist Window": "ネットリストウィンドウ",
    "Colormap Window": "カラーマップウィンドウ",
    "3D Display": "3D 表示",
    "Needs OpenGL, which the web build doesn't have": "OpenGL が必要ですが、ウェブ版にはありません",
    "Window Command Entry": "ウィンドウのコマンド入力",
    "Crosshair": "十字カーソル",
    "Start IRSIM first (Start IRSIM, or the irsim command)": "先に IRSIM を起動してください（「IRSIM を起動」または irsim コマンド）",
    "IRSIM prompt": "IRSIM プロンプト",
    "Start IRSIM": "IRSIM を起動",
    "Extract the window's cell, write its .sim and start IRSIM (the irsim command)":
        "ウィンドウのセルを抽出して .sim を書き出し、IRSIM を起動します（irsim コマンド）",
    "IRSIM Analyzer": "IRSIM アナライザー",
    "IRSIM Node Lists": "IRSIM ノードリスト",
    "Watch Selected Nodes": "選択したノードを監視",
    "watchnode: label the selected paint's nodes with their values": "watchnode：選択したペイントのノードに値のラベルを付けます",
    "LVS against a Schematic…": "回路図との LVS…",
    "Extract the window's cell and compare it with a schematic netlist (the lvs command)":
        "ウィンドウのセルを抽出し、回路図のネットリストと比較します（lvs コマンド）",
    "LVS Result": "LVS の結果",
    "Open in the IRSIM App": "IRSIM アプリで開く",
    "Extract the window's cell and simulate its .sim in the IRSIM web app, in a new tab":
        "ウィンドウのセルを抽出し、その .sim を新しいタブの IRSIM ウェブアプリでシミュレーションします",
    "Open in the netgen App": "netgen アプリで開く",
    "Extract the window's cell and compare it with its schematic in the netgen web app, in a new tab":
        "ウィンドウのセルを抽出し、新しいタブの netgen ウェブアプリで回路図と比較します",
    // Dialogs
    "New cell": "新しいセル",
    "Cell name": "セル名",
    "Create": "作成",
    "Place instance": "インスタンスを配置",
    "Places the cell at the box.": "セルをボックスの位置に配置します。",
    "Place": "配置",
    "The project has no schematic netlist: add one (a SPICE file) with Project > Add files to project.":
        "プロジェクトに回路図のネットリストがありません。「プロジェクト」>「プロジェクトにファイルを追加」で追加してください（SPICE ファイル）。",
    "{path} (project)": "{path}（プロジェクト）",
    "scmos (netgen's built-in setup)": "scmos（netgen 組み込みのセットアップ）",
    "LVS against a schematic": "回路図との LVS",
    "Extracts the cell in this window and compares it with the schematic.": "このウィンドウのセルを抽出し、回路図と比較します。",
    "Schematic netlist": "回路図のネットリスト",
    "Cell in it (empty: the one named like the layout, or the last)": "その中のセル（空欄：レイアウトと同じ名前のもの、なければ最後のもの）",
    "Setup": "セットアップ",
    "Run LVS": "LVS を実行",
    "Open cell": "セルを開く",
    "A cell in the project, or a new name to create one.": "プロジェクト内のセル、または新しく作るセルの名前です。",
    "Open": "開く",
    "Save cell": "セルを保存",
    "Save the edit cell as": "編集セルの保存名",
    "Save": "保存",
    "File name": "ファイル名",
    "Write and download": "書き出してダウンロード",
    "Text": "テキスト",
    "Puts a label at the box.": "ボックスの位置にラベルを置きます。",
    "Justification": "揃え",
    "default": "既定",
    "Font": "フォント",
    "default (no font)": "既定（フォントなし）",
    "Size (with font)": "サイズ（フォント使用時）",
    "Rotation (with font)": "回転（フォント使用時）",
    "Layer (optional)": "レイヤー（省略可）",
    "Apply": "適用",
    "Select a cell instance first (Cell > Select, or the i key).": "先にセルのインスタンスを選択してください（「セル」>「選択」、または i キー）。",
    "Already at the top of the hierarchy.": "すでに階層の最上位です。",
    // Title bar and toolbar
    "Background design rule checking": "デザインルールのバックグラウンド検査",
    "Command for this window": "このウィンドウへのコマンド",
    "Loaded: {loaded}  Editing: {editing}  Tool: {tool}  Technology: {tech}":
        "読み込み：{loaded}  編集：{editing}  ツール：{tool}  テクノロジー：{tech}",
    "none": "なし",
    "box ({x1} {y1}) to ({x2} {y2})": "ボックス ({x1} {y1})～({x2} {y2})",
    "no box": "ボックスなし",
    " (locked)": "（ロック中）",
    " (hidden)": "（非表示）",
    "click: show · right click: hide · u: unlock": "クリック：表示 · 右クリック：非表示 · u：ロック解除",
    "click: show · right click: hide · middle or Alt+click: paint · Shift+middle: erase":
        "クリック：表示 · 右クリック：非表示 · 中ボタンまたは Alt+クリック：ペイント · Shift+中ボタン：消去",
    "keys: p paint · e erase · s/S select more/less · l lock": "キー：p ペイント · e 消去 · s/S 選択に追加／選択から除く · l ロック",
});

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

    // The language changed: what the title bars, toolbars and managers show.
    languageChanged() {
        for(const frame of this.frames.values()) {
            frame.toolbar.retranslate();
        }
        this.update();
        for(const manager of Object.values(this.managers)) {
            if(manager.isOpen()) {
                manager.retranslate();
            }
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
            '<div class="mw-cmdentry" hidden><label>:</label><input data-i18n-aria-label="Command for this window" spellcheck="false" autocomplete="off"></div>';
        win.fw.body.appendChild(root);
        this.view = root.querySelector(".mw-view");
        const titlebar = root.querySelector(".mw-titlebar");

        titlebar.appendChild(menuBar(this.menus(), "Magic window menu",
            {onDone: () => this.win.canvas.focus({preventScroll: true})}));
        const drc = document.createElement("label");
        drc.className = "mw-drc";
        drc.dataset.i18nTitle = "Background design rule checking";
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
        applyStatic(root);

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
        const loaded = m ? m[1] : caption.split(/\s+/)[0] || t("none");
        const editing = m ? m[2] : caption;
        this.caption.textContent = t("Loaded: {loaded}  Editing: {editing}  Tool: {tool}  Technology: {tech}",
            {loaded, editing, tool: status.tool || "box", tech: status.tech || ""});
        this.caption.title = this.caption.textContent;
        if(status.tech && status.tech !== this.gui.tech) {
            this.gui.techChanged(status.tech);
        }
        const box = status.box ? status.box.split(" ") : null;
        this.boxText = box ? t("box ({x1} {y1}) to ({x2} {y2})", {x1: signed(box[0]), y1: signed(box[1]), x2: signed(box[2]), y2: signed(box[3])}) :
            t("no box");
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
                if(window.confirm(t("Throw away unsaved changes to {cell}?", {cell: windowCell()}))) {
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
                if(name && window.confirm(t("Delete cell {name} from memory?", {name}))) {
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
            ...GRID_STEPS.map(step => ({label: t("Set grid {step}", {step}), action: run(`grid ${step}`)})),
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
                    app.print(t("Drag layers in the toolbar to reorder them; choose Layers > Reorder layers again when done."), "info");
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
                ...[...new Set(styles)].map(style => ({label: t("DRC style {style}", {style}), checked: () => style === current,
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
            "-",
            ...this.simulationItems(),
            ...this.lvsItems(),
        ];

        return [["File", file], ["Edit", edit], ["Cell", cell], ["Window", windowMenu], ["Layers", layers],
            ["Drc", drc], ["Options", options]];
    }

    // IRSIM, through simulation.js: start it, or show its analyzer and node lists.
    simulationItems() {
        const sim = this.app.simulation;
        if(!sim) {
            return [];
        }
        const notRunning = "Start IRSIM first (Start IRSIM, or the irsim command)";
        return [
            sim.running ?
                {label: "IRSIM prompt", action: () => this.run("rsim")} :
                {label: "Start IRSIM", title: "Extract the window's cell, write its .sim and start IRSIM (the irsim command)",
                    action: () => this.app.run(this.wid, "irsim", false)},
            {label: "IRSIM Analyzer", checked: () => sim.analyzer.isOpen(), disabled: !sim.running, title: sim.running ? "" : notRunning,
                action: () => (sim.analyzer.isOpen() ? sim.analyzer.close() : sim.analyzer.open())},
            {label: "IRSIM Node Lists", checked: () => sim.traceManager.isOpen(), disabled: !sim.running, title: sim.running ? "" : notRunning,
                action: () => (sim.traceManager.isOpen() ? sim.traceManager.close() : sim.traceManager.open())},
            {label: "Watch Selected Nodes", disabled: !sim.running, title: sim.running ? "watchnode: label the selected paint's nodes with their values" : notRunning,
                action: () => this.app.run(this.wid, "watchnode", false)},
        ];
    }

    // LVS with netgen, through lvs.js: compare the window's cell with a schematic, and the Result window.
    lvsItems() {
        const lvs = this.app.verification;
        if(!lvs) {
            return [];
        }
        return [
            "-",
            {label: "LVS against a Schematic…", title: "Extract the window's cell and compare it with a schematic netlist (the lvs command)",
                action: () => this.lvsDialog()},
            {label: "LVS Result", checked: () => lvs.resultWindow.isOpen(),
                action: () => (lvs.resultWindow.isOpen() ? lvs.resultWindow.close() : lvs.resultWindow.open())},
            "-",
            {label: "Open in the IRSIM App", title: "Extract the window's cell and simulate its .sim in the IRSIM web app, in a new tab",
                disabled: !this.app.simulation, action: () => this.app.simulation.sendToIrsim(this.wid)},
            {label: "Open in the netgen App", title: "Extract the window's cell and compare it with its schematic in the netgen web app, in a new tab",
                action: () => lvs.sendToNetgen(this.wid)},
        ];
    }

    async lvsDialog() {
        const lvs = this.app.verification, files = lvs.files();
        const netlists = files.filter(p => /\.(spice|spi|sp|cir|ckt|cdl|net|netlist|v|vg)$/i.test(p) &&
            !/^\* \w+ file created from .*\.ext/i.test(new TextDecoder().decode(lvs.read(p).subarray(0, 200))));
        if(!netlists.length) {
            this.app.print(t("The project has no schematic netlist: add one (a SPICE file) with Project > Add files to project."), "error");
            return;
        }
        const setups = [...files.filter(p => /\.tcl$/i.test(p)).map(p => [p, t("{path} (project)", {path: p})]), ["/setups/scmos.tcl", "scmos (netgen's built-in setup)"]];
        const v = await ask({title: "LVS against a schematic", message: "Extracts the cell in this window and compares it with the schematic.",
            fields: [
                {name: "schematic", label: "Schematic netlist", options: netlists.map(p => [p, p])},
                {name: "cell", label: "Cell in it (empty: the one named like the layout, or the last)", value: ""},
                {name: "setup", label: "Setup", options: setups},
            ], ok: "Run LVS"});
        if(v) {
            this.app.run(this.wid, ["lvs", v.schematic, v.cell.trim() || "-", v.setup].join(" "), false);
        }
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
            this.app.print(t("Select a cell instance first (Cell > Select, or the i key)."), "error");
            return;
        }
        this.stack.push({cell: root, view: this.status.view});
        this.run(`load ${cell}`, false);
    }

    up() {
        const last = this.stack.pop();
        if(!last) {
            this.app.print(t("Already at the top of the hierarchy."), "info");
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
        this.element.dataset.i18nAriaLabel = "Layers";
        this.element.setAttribute("aria-label", t("Layers"));
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

    // The language changed: the rows' tooltips again.
    retranslate() {
        for(const row of this.rows.values()) {
            delete row.dataset.state;
        }
        this.refresh();
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
            row.title = layer.name + (layer.locked ? t(" (locked)") : "") + (layer.visible ? "" : t(" (hidden)")) +
                (layer.locked ? "\n" + t("click: show · right click: hide · u: unlock") :
                    "\n" + t("click: show · right click: hide · middle or Alt+click: paint · Shift+middle: erase") +
                    "\n" + t("keys: p paint · e erase · s/S select more/less · l lock"));
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
            frame.setMessage(layer ? layer.name + (layer.locked ? t(" (locked)") : "") : "");
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
