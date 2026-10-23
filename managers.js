// SPDX-License-Identifier: GPL-2.0-or-later
// The managers from the Tcl wrapper's Options menu, as floating windows:
// cell manager (tcltk/cellmgr.tcl), library manager (tcltk/libmgr.tcl),
// technology manager (the techmanager procs in tcltk/wrapper.tcl) and DRC
// manager (tcltk/drcmgr.tcl).

import {FloatingWindow} from "./floating-window.js";
import {t, register} from "./i18n.js";

// The managers' text in Japanese (i18n.js).  Cell names, styles and DRC rules are Magic's.
register({
    "Layout window that the buttons act on": "ボタンの操作対象のレイアウトウィンドウ",
    "default window": "既定のウィンドウ",
    "window {n}": "ウィンドウ {n}",
    "Refresh": "更新",
    // Cell manager
    "Cell Manager": "セルマネージャー",
    "Zoom": "ズーム",
    "Show the selected cell or instance": "選択したセルまたはインスタンスを表示します",
    "Edit": "編集",
    "Make it the edit cell": "編集セルにします",
    "Load": "読み込み",
    "Load its definition into the window": "その定義をウィンドウに読み込みます",
    "Expand": "展開",
    "Toggle its expansion": "展開を切り替えます",
    "Place": "配置",
    "Place an instance of it at the box": "そのインスタンスをボックスの位置に配置します",
    "Cell hierarchy": "セルの階層",
    "No cells loaded.": "読み込まれているセルはありません。",
    "Choose a cell in the Cell Manager first.": "先にセルマネージャーでセルを選んでください。",
    // Library manager
    "Library Manager": "ライブラリマネージャー",
    "Load the cell into the window": "セルをウィンドウに読み込みます",
    "Place an instance at the box": "インスタンスをボックスの位置に配置します",
    "Add files…": "ファイルを追加…",
    "Add .mag files to the project": ".mag ファイルをプロジェクトに追加します",
    "Project cells": "プロジェクトのセル",
    "No .mag files in the project.": "プロジェクトに .mag ファイルはありません。",
    // Technology manager
    "Technology Manager": "テクノロジーマネージャー",
    "Load technology {name}? Layout already in memory may become invalid.":
        "テクノロジー {name} を読み込みますか？メモリ上のレイアウトが無効になることがあります。",
    "Technology": "テクノロジー",
    "version {version} · {description}": "バージョン {version} · {description}",
    "Microns per lambda (CIF)": "lambda あたりのミクロン数（CIF）",
    "Internal units": "内部単位",
    "Lambda": "lambda",
    "Press Enter to apply (scalegrid)": "Enter で適用します（scalegrid）",
    "Internal units per lambda": "lambda あたりの内部単位数",
    "CIF input style": "CIF 入力スタイル",
    "CIF output style": "CIF 出力スタイル",
    "Extract style": "抽出スタイル",
    "DRC style": "DRC スタイル",
    // DRC manager
    "DRC Manager": "DRC マネージャー",
    "Update": "更新",
    "Check the whole cell again and list the errors": "セル全体をもう一度検査し、エラーを一覧にします",
    "Last": "前へ",
    "Next": "次へ",
    "Save": "保存",
    "Download the error report": "エラーのレポートをダウンロードします",
    "DRC errors": "DRC エラー",
    "1 error": "エラー 1 件",
    "{n} errors": "エラー {n} 件",
    "No DRC errors.": "DRC エラーはありません。",
    "DRC report for {cell} (coordinates in internal units: llx lly urx ury)":
        "{cell} の DRC レポート（座標は内部単位：llx lly urx ury）",
});

const STYLES = `
.mg-body { display: flex; flex-direction: column; height: 100%; font-size: 13px; }
.mg-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; padding: 6px; border-bottom: 1px solid var(--rule); }
.mg-bar button, .mg-bar select { font: inherit; font-size: 12px; min-height: 24px; padding: 1px 8px; }
.mg-bar .mg-grow { flex: 1; }
.mg-list { flex: 1; overflow: auto; margin: 0; padding: 4px 0; list-style: none; font-family: var(--mono); font-size: 12px; }
.mg-list li { padding: 1px 8px; white-space: nowrap; cursor: default; outline: none; }
.mg-list li[aria-selected="true"] { background: var(--accent); color: #fff; }
.mg-list li[aria-selected="true"] .mg-dim { color: inherit; opacity: .8; }
.mg-list li:focus-visible { box-shadow: inset 0 0 0 2px var(--accent); }
.mg-twisty { display: inline-block; width: 1.2em; text-align: center; cursor: pointer; }
.mg-dim { color: var(--muted); }
.mg-form { display: grid; grid-template-columns: auto 1fr; gap: 6px 10px; padding: 10px 12px; align-items: center; overflow: auto; }
.mg-form select, .mg-form input { font: 12px var(--mono); color: inherit; background: var(--log-bg); border: 1px solid var(--rule);
  border-radius: 4px; padding: 2px 4px; min-width: 0; }
.mg-form .mg-wide { grid-column: 1 / -1; color: var(--muted); }
.mg-empty { padding: 10px 12px; color: var(--muted); }
`;

function addStyles() {
    if(!document.getElementById("mg-styles")) {
        const style = document.createElement("style");
        style.id = "mg-styles";
        style.textContent = STYLES;
        document.head.appendChild(style);
    }
}

function records(text) {
    return text.split("\n").filter(Boolean).map(line => line.split("\t"));
}

// Labels and titles are given in English; applyStatic() translates them again when the
// language changes.
function button(label, action, title) {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.i18n = label;
    b.textContent = t(label);
    if(title) {
        b.dataset.i18nTitle = title;
        b.title = t(title);
    }
    b.addEventListener("click", action);
    return b;
}

class Manager {
    constructor(gui, title, geometry) {
        addStyles();
        this.gui = gui;
        this.app = gui.app;
        this.title = title;
        this.geometry = geometry;
        this.fw = null;
        this.targetWid = -1;
    }

    isOpen() {
        return Boolean(this.fw);
    }

    open() {
        if(this.fw) {
            this.fw.raise();
            return;
        }
        const desktop = this.app.driver.desktop, g = this.geometry;
        this.fw = new FloatingWindow(desktop, {
            title: this.title,
            x: Math.max(0, desktop.clientWidth - g.width - 12 - 2 * (g.y - 40)), y: g.y, width: g.width, height: g.height,
            onClose: () => this.close(),
            topmost: true,
        });
        this.body = document.createElement("div");
        this.body.className = "mg-body";
        this.fw.body.appendChild(this.body);
        this.build();
        this.refresh();
    }

    close() {
        this.fw?.remove();
        this.fw = null;
    }

    // A "target window" chooser, as in the Tcl managers.
    targetSelect() {
        const select = document.createElement("select");
        select.dataset.i18nTitle = "Layout window that the buttons act on";
        select.title = t("Layout window that the buttons act on");
        const fill = () => {
            const current = select.value;
            select.textContent = "";
            select.add(new Option(t("default window"), "-1"));
            for(const w of this.gui.windowsOf("layout")) {
                select.add(new Option(t("window {n}", {n: w.wid}), String(w.wid)));
            }
            select.value = [...select.options].some(o => o.value === current) ? current : "-1";
        };
        select.addEventListener("focus", fill);
        this.fillTargets = fill;
        select.addEventListener("change", () => {
            this.targetWid = Number(select.value);
        });
        fill();
        return select;
    }

    target() {
        return this.gui.target(this.targetWid);
    }

    run(command, quiet = false) {
        return this.app.run(this.target(), command, quiet);
    }

    refreshIfStale() {
    }

    // The language changed: the buttons follow by themselves (applyStatic); the rest is redrawn.
    retranslate() {
        this.fillTargets?.();
        this.refresh();
    }
}

// A keyboard-navigable list with single selection.
function selectableList(onChoose) {
    const list = document.createElement("ul");
    list.className = "mg-list";
    list.setAttribute("role", "listbox");
    list.tabIndex = 0;
    const select = li => {
        for(const other of list.querySelectorAll('[aria-selected="true"]')) {
            other.setAttribute("aria-selected", "false");
        }
        if(li) {
            li.setAttribute("aria-selected", "true");
            li.scrollIntoView({block: "nearest"});
        }
    };
    list.addEventListener("click", event => {
        const li = event.target.closest("li[role=option]");
        if(li && !event.target.closest(".mg-twisty")) {
            select(li);
        }
    });
    list.addEventListener("dblclick", event => {
        const li = event.target.closest("li[role=option]");
        if(li && !event.target.closest(".mg-twisty")) {
            onChoose(li);
        }
    });
    list.addEventListener("keydown", event => {
        const items = [...list.querySelectorAll("li[role=option]:not([hidden])")];
        const current = list.querySelector('[aria-selected="true"]');
        const i = items.indexOf(current);
        if(event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            select(items[Math.max(0, Math.min(items.length - 1, i + (event.key === "ArrowDown" ? 1 : -1)))]);
        } else if(event.key === "Enter" && current) {
            event.preventDefault();
            onChoose(current);
        } else if((event.key === "ArrowRight" || event.key === "ArrowLeft") && current) {
            current.querySelector(".mg-twisty")?.dispatchEvent(new MouseEvent("click", {bubbles: true}));
        }
    });
    list.selected = () => list.querySelector('[aria-selected="true"]');
    list.select = select;
    return list;
}

// ----- Cell manager: the cell hierarchy, with Zoom, Edit, Load, Expand and Place.

export class CellManager extends Manager {
    constructor(gui) {
        super(gui, "Cell Manager", {y: 40, width: 300, height: 380});
        this.text = "";
        this.collapsed = new Set();
    }

    build() {
        const bar = document.createElement("div");
        bar.className = "mg-bar";
        bar.append(
            button("Zoom", () => this.act("zoom"), "Show the selected cell or instance"),
            button("Edit", () => this.act("edit"), "Make it the edit cell"),
            button("Load", () => this.act("load"), "Load its definition into the window"),
            button("Expand", () => this.act("expand"), "Toggle its expansion"),
            button("Place", () => this.act("place"), "Place an instance of it at the box"),
            button("Refresh", () => this.refresh()),
            this.targetSelect());
        this.list = selectableList(() => this.act("zoom"));
        this.list.dataset.i18nAriaLabel = "Cell hierarchy";
        this.list.setAttribute("aria-label", t("Cell hierarchy"));
        this.body.append(bar, this.list);
    }

    refreshIfStale() {
        if(this.app.query("magic_web_hierarchy", []) !== this.text) {
            this.refresh();
        }
    }

    refresh() {
        if(!this.fw) {
            return;
        }
        this.text = this.app.query("magic_web_hierarchy", []);
        const selected = this.list.selected()?.dataset.path;
        this.list.textContent = "";
        const path = [];
        const rows = records(this.text).map(([depth, cell, inst]) => ({depth: Number(depth), cell, inst}));
        rows.forEach((row, i) => {
            path.length = row.depth;
            path.push(row.depth === 0 ? row.cell : row.inst);
            const li = document.createElement("li");
            li.setAttribute("role", "option");
            li.setAttribute("aria-selected", "false");
            li.dataset.path = path.join("/");
            li.dataset.cell = row.cell;
            li.dataset.depth = row.depth;
            li.style.paddingLeft = 8 + row.depth * 16 + "px";
            const hasChildren = rows[i + 1] && rows[i + 1].depth > row.depth;
            const twisty = document.createElement("span");
            twisty.className = "mg-twisty";
            twisty.textContent = hasChildren ? (this.collapsed.has(li.dataset.path) ? "▸" : "▾") : "";
            twisty.addEventListener("click", () => {
                if(!hasChildren) {
                    return;
                }
                if(this.collapsed.has(li.dataset.path)) {
                    this.collapsed.delete(li.dataset.path);
                } else {
                    this.collapsed.add(li.dataset.path);
                }
                this.refresh();
            });
            li.appendChild(twisty);
            li.append(row.depth === 0 ? row.cell : row.inst);
            if(row.depth > 0) {
                const def = document.createElement("span");
                def.className = "mg-dim";
                def.textContent = ` (${row.cell})`;
                li.appendChild(def);
            }
            li.hidden = path.slice(0, -1).some((_, k) => this.collapsed.has(path.slice(0, k + 1).join("/")));
            this.list.appendChild(li);
        });
        if(!rows.length) {
            this.list.innerHTML = '<li class="mg-empty"></li>';
            this.list.firstChild.textContent = t("No cells loaded.");
        }
        const again = selected && [...this.list.children].find(li => li.dataset.path === selected);
        this.list.select(again || null);
    }

    // As magic::instcallback in tcltk/cellmgr.tcl.
    act(command) {
        const li = this.list.selected();
        if(!li) {
            this.app.print(t("Choose a cell in the Cell Manager first."), "info");
            return;
        }
        const parts = li.dataset.path.split("/"), root = parts[0], cell = li.dataset.cell;
        const frame = this.gui.frames.get(this.target());
        const windowRoot = frame ? (/^(\S+)/.exec(frame.status.caption || "") || [])[1] : null;
        if(command === "load") {
            this.run(`load ${cell}`);
            return;
        }
        if(command === "place") {
            this.run(`getcell ${cell}`);
            return;
        }
        if(windowRoot !== root) {
            this.run(`load ${root}`);
        }
        if(parts.length === 1) {
            this.run("select top cell");
            if(command === "edit") {
                this.run("expand");
                this.run("edit");
            } else if(command === "expand") {
                this.run("expand");
            } else {
                this.run("view");
            }
        } else {
            this.run(`select cell ${parts.slice(1).join("/")}`);
            if(command === "edit") {
                this.run("expand");
                this.run("edit");
            } else if(command === "expand") {
                this.run("expand toggle");
            } else {
                this.run("findbox zoom");
            }
        }
    }
}

// ----- Library manager: the .mag files of the project, by folder.

export class LibraryManager extends Manager {
    constructor(gui) {
        super(gui, "Library Manager", {y: 80, width: 300, height: 340});
    }

    build() {
        const bar = document.createElement("div");
        bar.className = "mg-bar";
        bar.append(
            button("Load", () => this.act("load"), "Load the cell into the window"),
            button("Place", () => this.act("place"), "Place an instance at the box"),
            button("Add files…", () => this.app.addFiles(), "Add .mag files to the project"),
            button("Refresh", () => this.refresh()),
            this.targetSelect());
        this.list = selectableList(() => this.act("load"));
        this.list.dataset.i18nAriaLabel = "Project cells";
        this.list.setAttribute("aria-label", t("Project cells"));
        this.body.append(bar, this.list);
    }

    refresh() {
        if(!this.fw) {
            return;
        }
        const selected = this.list.selected()?.dataset.cell;
        this.list.textContent = "";
        const byFolder = new Map();
        for(const path of this.app.projectFiles().filter(p => /\.mag$/i.test(p)).sort()) {
            const cut = path.lastIndexOf("/");
            const folder = cut < 0 ? "." : path.slice(0, cut);
            if(!byFolder.has(folder)) {
                byFolder.set(folder, []);
            }
            byFolder.get(folder).push(path.replace(/\.mag$/i, ""));
        }
        for(const [folder, cells] of byFolder) {
            const head = document.createElement("li");
            head.className = "mg-dim";
            head.textContent = folder === "." ? (this.app.project?.name || "project") + "/" : folder + "/";
            this.list.appendChild(head);
            for(const cell of cells) {
                const li = document.createElement("li");
                li.setAttribute("role", "option");
                li.setAttribute("aria-selected", "false");
                li.dataset.cell = cell;
                li.style.paddingLeft = "24px";
                li.textContent = cell.split("/").pop();
                this.list.appendChild(li);
            }
        }
        if(!byFolder.size) {
            this.list.innerHTML = '<li class="mg-empty"></li>';
            this.list.firstChild.textContent = t("No .mag files in the project.");
        }
        this.list.select((selected && [...this.list.children].find(li => li.dataset.cell === selected)) || null);
    }

    act(command) {
        const li = this.list.selected();
        if(li) {
            this.run(`${command === "place" ? "getcell" : "load"} ${li.dataset.cell}`);
        }
    }
}

// ----- Technology manager: technology, lambda and the CIF, extraction and DRC styles.

export class TechManager extends Manager {
    constructor(gui) {
        super(gui, "Technology Manager", {y: 60, width: 340, height: 330});
    }

    build() {
        this.form = document.createElement("div");
        this.form.className = "mg-form";
        this.body.appendChild(this.form);
    }

    refresh() {
        if(!this.fw) {
            return;
        }
        const info = Object.fromEntries(records(this.app.query("magic_web_tech", [])).map(r => [r[0], r.slice(1)]));
        this.form.textContent = "";
        const row = (label, control) => {
            const l = document.createElement("label");
            l.textContent = t(label);
            this.form.append(l, control);
        };
        const text = value => {
            const span = document.createElement("span");
            span.textContent = value;
            return span;
        };
        const styleSelect = (styles, command) => {
            const [current, ...all] = styles || [""];
            const select = document.createElement("select");
            for(const style of [...new Set(all)]) {
                select.add(new Option(style, style));
            }
            select.value = current;
            select.addEventListener("change", () => {
                this.app.run(-1, `${command} ${select.value}`);
                this.refresh();
            });
            return select;
        };

        const techs = [...new Set([info.name?.[0], "scmos", "minimum", ...this.app.projectTechs()].filter(Boolean))];
        const tech = document.createElement("select");
        for(const name of techs) {
            tech.add(new Option(name, name));
        }
        tech.value = info.name?.[0] || "";
        tech.addEventListener("change", () => {
            if(window.confirm(t("Load technology {name}? Layout already in memory may become invalid.", {name: tech.value}))) {
                this.app.run(-1, `tech load ${tech.value} -noprompt`);
            }
            this.refresh();
        });
        row("Technology", tech);
        const wide = document.createElement("div");
        wide.className = "mg-wide";
        wide.textContent = t("version {version} · {description}", {version: info.version?.[0] || "?", description: info.description?.[0] || ""});
        this.form.appendChild(wide);

        const [num, den] = (info.lambda?.[0] || "1 1").split(" ").map(Number);
        const scale = /([\d.]+) microns/.exec(this.app.capture(-1, "cif scale output").join(" "));
        row("Microns per lambda (CIF)", text(scale ? String(Number(scale[1]) * den / num) : "?"));
        const lambda = document.createElement("span");
        const n = document.createElement("input"), d = document.createElement("input");
        n.size = d.size = 3;
        n.value = num;
        d.value = den;
        n.setAttribute("aria-label", t("Internal units"));
        d.setAttribute("aria-label", t("Lambda"));
        const apply = event => {
            if(event.key === "Enter") {
                this.app.run(-1, `scalegrid ${n.value} ${d.value}`);
                this.refresh();
            }
        };
        n.addEventListener("keydown", apply);
        d.addEventListener("keydown", apply);
        lambda.append(n, " / ", d);
        lambda.title = t("Press Enter to apply (scalegrid)");
        row("Internal units per lambda", lambda);
        row("CIF input style", styleSelect(info.cifin, "cif istyle"));
        row("CIF output style", styleSelect(info.cifout, "cif ostyle"));
        row("Extract style", styleSelect(info.extract, "extract style"));
        row("DRC style", styleSelect(info.drc, "drc style"));
    }
}

// ----- DRC manager: every error in the window's cell, grouped by rule.

export class DrcManager extends Manager {
    constructor(gui) {
        super(gui, "DRC Manager", {y: 100, width: 380, height: 360});
        this.collapsed = new Set();
    }

    build() {
        const bar = document.createElement("div");
        bar.className = "mg-bar";
        bar.append(
            button("Update", () => {
                this.run("drc check", true);
                this.run("drc catchup", true);
                this.refresh();
            }, "Check the whole cell again and list the errors"),
            button("Last", () => this.step(-1)),
            button("Next", () => this.step(1)),
            button("Save", () => this.save(), "Download the error report"),
            button("Zoom", () => this.zoom()),
            this.targetSelect());
        this.summary = document.createElement("span");
        this.summary.className = "mg-dim mg-grow";
        bar.appendChild(this.summary);
        this.list = selectableList(() => this.zoom());
        this.list.dataset.i18nAriaLabel = "DRC errors";
        this.list.setAttribute("aria-label", t("DRC errors"));
        this.list.addEventListener("click", event => {
            if(event.target.closest("li[data-box]") && !event.target.closest(".mg-twisty")) {
                this.zoom();
            }
        });
        this.body.append(bar, this.list);
    }

    refresh() {
        if(!this.fw) {
            return;
        }
        this.errors = records(this.app.query("magic_web_drc_list", [this.target()]));
        const byRule = new Map();
        for(const [rule, box] of this.errors) {
            if(!byRule.has(rule)) {
                byRule.set(rule, []);
            }
            byRule.get(rule).push(box);
        }
        this.list.textContent = "";
        for(const [rule, boxes] of byRule) {
            const head = document.createElement("li");
            head.setAttribute("role", "option");
            head.setAttribute("aria-selected", "false");
            const twisty = document.createElement("span");
            twisty.className = "mg-twisty";
            twisty.textContent = this.collapsed.has(rule) ? "▸" : "▾";
            twisty.addEventListener("click", () => {
                if(this.collapsed.has(rule)) {
                    this.collapsed.delete(rule);
                } else {
                    this.collapsed.add(rule);
                }
                this.refresh();
            });
            head.append(twisty, `${rule} (${boxes.length})`);
            head.style.whiteSpace = "normal";
            this.list.appendChild(head);
            for(const box of boxes) {
                const li = document.createElement("li");
                li.setAttribute("role", "option");
                li.setAttribute("aria-selected", "false");
                li.dataset.box = box;
                li.style.paddingLeft = "28px";
                li.textContent = box.split(" ").join(", ");
                li.hidden = this.collapsed.has(rule);
                this.list.appendChild(li);
            }
        }
        this.summary.textContent = t(this.errors.length === 1 ? "1 error" : "{n} errors", {n: this.errors.length});
        if(!this.errors.length) {
            this.list.innerHTML = '<li class="mg-empty"></li>';
            this.list.firstChild.textContent = t("No DRC errors.");
        }
    }

    zoom() {
        const li = this.list.selected();
        if(li && li.dataset.box) {
            this.run(`box ${li.dataset.box.split(" ").map(v => v + "i").join(" ")}`, true);
            this.run("findbox zoom", true);
            this.run("zoom 4", true);
            this.run("drc why");
        }
    }

    step(direction) {
        const boxes = [...this.list.querySelectorAll("li[data-box]")];
        if(!boxes.length) {
            return;
        }
        const i = boxes.indexOf(this.list.selected());
        const next = boxes[(i + direction + boxes.length) % boxes.length];
        next.hidden = false;
        this.list.select(next);
        this.zoom();
    }

    save() {
        const cell = (/^(\S+)/.exec(this.gui.frames.get(this.target())?.status.caption || "") || [])[1] || "layout";
        const lines = [t("DRC report for {cell} (coordinates in internal units: llx lly urx ury)", {cell}), ""];
        let last = null;
        for(const [rule, box] of this.errors || []) {
            if(rule !== last) {
                lines.push(rule);
                last = rule;
            }
            lines.push("    " + box);
        }
        this.app.saveText(`${cell}.drc.txt`, lines.join("\n") + "\n");
    }
}
