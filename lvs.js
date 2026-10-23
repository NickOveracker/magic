// SPDX-License-Identifier: GPL-2.0-or-later
// LVS from the Magic page: compare the layout in the window with a schematic,
// using netgen from the netgen submodule (netgen/), as the irsim command uses
// IRSIM from the irsim submodule.
//
//   lvs [schematic [cell [setup]]]          (cell "-": choose it as below)
//
// extracts the window's cell (extract all, then ext2spice lvs, which writes
// <cell>.spice), and runs netgen's lvs on it and the schematic: a SPICE (or
// Verilog) netlist in the project.  Without arguments the schematic is the
// project's netlist named after the cell with "sch" in it, or else the one
// named just like the cell (dff.sp for dff), one with "sch" in it, or the only
// other netlist; its cell is the subcircuit named like the layout's, or else
// the last one; the setup is the project's *setup*.tcl, or else netgen's
// built-in one for scmos.  netgen's report goes into the project as comp.out
// and comp.json, and the Result window (from netgen/lvs.js) shows it.
//
// netgen is loaded only when lvs is first used, in a Web Worker of its own.

import {Session} from "./netgen/session.js";
import {LvsRunner, ResultWindow} from "./netgen/lvs.js";
import {appUrl, sendProject} from "./handoff.js";
import {t, register} from "./i18n.js";

// The page's messages about LVS in Japanese (i18n.js); netgen's own output stays as it is.
register({
    "Run lvs (or Options > LVS against a Schematic) to compare the layout with its schematic.":
        "lvs（または「オプション」>「回路図との LVS…」）を実行すると、レイアウトを回路図と比較します。",
    "lvs compares the cell in the window with a schematic: load a cell first.": "lvs はウィンドウのセルを回路図と比較します。先にセルを読み込んでください。",
    "Magic didn't write {file}; see the messages above.": "Magic は {file} を書き出しませんでした。上のメッセージを見てください。",
    "{cell} declares no ports, so netgen can't match its pins with the schematic's. Make the pin labels ports (select the labels, then port make; or port makeall for every label) and run lvs again.":
        "{cell} にはポートが宣言されていないため、netgen はそのピンを回路図のピンと対応付けられません。ピンのラベルをポートにして（ラベルを選択して port make、またはすべてのラベルに port makeall）、もう一度 lvs を実行してください。",
    "There is no {path} in the project. Usage: lvs [schematic [cell [setup]]]": "プロジェクトに {path} はありません。使い方：lvs [schematic [cell [setup]]]",
    "Which schematic? The project has {files}: lvs <schematic> [cell [setup]]": "どの回路図を使いますか？プロジェクトには {files} があります：lvs <schematic> [cell [setup]]",
    "The project has no schematic netlist to compare {cell} with. Add one (a SPICE file, for example {cell}_schematic.spice) with Project > Add files to project, then run lvs.":
        "{cell} と比較する回路図のネットリストがプロジェクトにありません。「プロジェクト」>「プロジェクトにファイルを追加」で追加して（SPICE ファイル。例：{cell}_schematic.spice）、lvs を実行してください。",
    "There is no {path} in the project.": "プロジェクトに {path} はありません。",
    "Comparing the layout of {cell} with {schematic}{part}{setup}.": "{cell} のレイアウトを {schematic}{part} と比較します{setup}。",
    ", cell {cell}": " のセル {cell}",
    " (netgen's built-in scmos setup)": "（netgen 組み込みの scmos 用セットアップ）",
    " (setup {setup})": "（セットアップ {setup}）",
    "LVS: {final} (comp.out and comp.json in the project)": "LVS：{final}（comp.out と comp.json をプロジェクトに保存）",
    "Loading netgen…": "netgen を読み込み中…",
    "Couldn't load netgen: {why}": "netgen を読み込めませんでした：{why}",
    "netgen could not start.": "netgen を起動できませんでした。",
    "netgen, Copyright 1990, 1991, 2002, 2004, 2005 Massimo A. Sivilotti, Caltech, and R. Timothy Edwards, MultiGiG, Inc., changed for this WebAssembly build in 2026. netgen comes with ABSOLUTELY NO WARRANTY. It is free software: you may redistribute it under the terms of the GNU General Public License; About > netgen license shows a copy.":
        "netgen、Copyright 1990, 1991, 2002, 2004, 2005 Massimo A. Sivilotti, Caltech, and R. Timothy Edwards, MultiGiG, Inc.。2026 年にこの WebAssembly 版のために変更されています。netgen は完全に無保証です。netgen はフリーソフトウェアであり、GNU 一般公衆利用許諾書（GPL）の条件のもとで再頒布できます。その写しは「情報」>「netgen のライセンス」にあります。",
    "Sending {files} to the netgen app, in a new tab.": "{files} を新しいタブの netgen アプリに送ります。",
    "Couldn't send them: {why}": "送れませんでした：{why}",
});

const NETLIST = /\.(spice|spi|sp|cir|ckt|cdl|net|netlist|v|vg)$/i;
const BUILT_IN_SETUP = "/setups/scmos.tcl";
const decoder = new TextDecoder();

export class Verification {
    // host: {magic, print(text, kind), run(wid, line, quiet), projectRoot(), desktop, saveBlob,
    //        windowCell(), filesChanged()}
    constructor(host) {
        this.host = host;
        this.session = null;
        this.result = null;
        this.runner = new LvsRunner({
            run: async (command, {echo}) => {
                if(echo) {
                    host.print("netgen> " + command, "command");
                }
                const reply = await this.session.run(command);
                if(!reply.ended && reply.result) {
                    host.print(reply.result, reply.code === 0 ? null : "error");
                }
                return reply;
            },
            readFile: path => this.session.readFile(path),
        });
        this.resultWindow = new ResultWindow({desktop: host.desktop, saveBlob: host.saveBlob, result: () => this.result,
            emptyText: () => t("Run lvs (or Options > LVS against a Schematic) to compare the layout with its schematic.")});
    }

    get busy() {
        return Boolean(this.session?.busy);
    }

    // The page's lvs command; returns a promise if it took the line, otherwise null.
    frontEnd(wid, line) {
        const [cmd, ...args] = line.trim().split(/\s+/);
        return cmd === "lvs" ? this.lvs(wid, args) : null;
    }

    // ----- The project's files, in Magic's file system

    files() {
        const fs = this.host.magic.FS, root = this.host.projectRoot(), out = [];
        const walk = (dir, prefix) => {
            for(const name of fs.readdir(dir)) {
                if(name === "." || name === "..") {
                    continue;
                }
                const path = dir + "/" + name;
                fs.isDir(fs.stat(path).mode) ? walk(path, prefix + name + "/") : out.push(prefix + name);
            }
        };
        walk(root, "");
        return out;
    }

    read(path) {
        return this.host.magic.FS.readFile(`${this.host.projectRoot()}/${path}`);
    }

    subcircuits(path) {
        return [...decoder.decode(this.read(path)).matchAll(/^\s*\.subckt\s+(\S+)/gim)].map(m => m[1]);
    }

    // ----- lvs

    // Extract the window's cell, and choose the schematic, its cell and the setup; returns
    // {cell, layout, schematic, schematicCell, setup}, or null (after saying why).
    prepare(wid, [schematic, schematicCell, setup]) {
        const host = this.host, cell = host.windowCell();
        if(!cell) {
            host.print(t("lvs compares the cell in the window with a schematic: load a cell first."), "error");
            return null;
        }
        // The layout's netlist, as Magic's LVS flow writes it.
        host.run(wid, "extract all", false);
        host.run(wid, "ext2spice lvs", false);
        host.run(wid, "ext2spice", false);
        const layout = `${cell}.spice`;
        let layoutText;
        try {
            layoutText = decoder.decode(this.read(layout));
        } catch(e) {
            host.print(t("Magic didn't write {file}; see the messages above.", {file: layout}), "error");
            return null;
        }
        const header = layoutText.split("\n").find(l => /^\s*\.subckt\s/i.test(l)) || "";
        if(header.trim().split(/\s+/).length <= 2) {
            host.print(t("{cell} declares no ports, so netgen can't match its pins with the schematic's. " +
                "Make the pin labels ports (select the labels, then port make; or port makeall for every label) and run lvs again.", {cell}), "info");
        }
        // The schematic.
        const files = this.files();
        if(schematic) {
            if(!files.includes(schematic)) {
                host.print(t("There is no {path} in the project. Usage: lvs [schematic [cell [setup]]]", {path: schematic}), "error");
                return null;
            }
        } else {
            const candidates = files.filter(p => NETLIST.test(p) && p !== layout &&
                !/^\* \w+ file created from .*\.ext/i.test(decoder.decode(this.read(p).subarray(0, 200))));
            const base = p => p.split("/").pop().toLowerCase();
            const stem = p => base(p).replace(/\.\w+$/, "");
            schematic = candidates.find(p => base(p).includes(cell.toLowerCase()) && /sch/.test(base(p))) ||
                candidates.find(p => stem(p) === cell.toLowerCase()) ||
                candidates.find(p => /sch/.test(base(p))) || (candidates.length === 1 ? candidates[0] : null);
            if(!schematic) {
                host.print(candidates.length ? t("Which schematic? The project has {files}: lvs <schematic> [cell [setup]]", {files: candidates.join(", ")}) :
                    t("The project has no schematic netlist to compare {cell} with. Add one (a SPICE file, for example " +
                    "{cell}_schematic.spice) with Project > Add files to project, then run lvs.", {cell}), "error");
                return null;
            }
        }
        if(!schematicCell || schematicCell === "-") {
            const cells = this.subcircuits(schematic);
            schematicCell = cells.find(c => c.toLowerCase() === cell.toLowerCase()) || cells[cells.length - 1] || "";
        }
        // The setup.
        if(!setup) {
            setup = files.find(p => /setup.*\.tcl$/i.test(p)) || BUILT_IN_SETUP;
        } else if(setup !== BUILT_IN_SETUP && !files.includes(setup)) {
            host.print(t("There is no {path} in the project.", {path: setup}), "error");
            return null;
        }
        return {cell, layout, schematic, schematicCell, setup};
    }

    async lvs(wid, args) {
        const host = this.host, circuits = this.prepare(wid, args);
        if(!circuits) {
            return;
        }
        const {cell, layout, schematic, schematicCell, setup} = circuits;
        host.print(t("Comparing the layout of {cell} with {schematic}{part}{setup}.", {cell, schematic,
            part: schematicCell ? t(", cell {cell}", {cell: schematicCell}) : "",
            setup: setup === BUILT_IN_SETUP ? t(" (netgen's built-in scmos setup)") : t(" (setup {setup})", {setup})}), "info");

        if(!await this.start()) {
            return;
        }
        for(const path of [layout, schematic, ...(setup === BUILT_IN_SETUP ? [] : [setup])]) {
            await this.session.writeFile(path, this.read(path));
        }
        const result = await this.runner.compare({circuit1: [layout, cell], circuit2: [schematic, schematicCell], setup, blackbox: false});
        if(!result) {
            return;
        }
        this.result = result;
        // netgen's report into the project, as native netgen would leave it.
        const root = host.projectRoot(), fs = host.magic.FS;
        fs.writeFile(`${root}/comp.out`, result.report);
        if(result.json) {
            fs.writeFile(`${root}/comp.json`, JSON.stringify(result.json, null, 1));
        }
        host.filesChanged();
        host.print(t("LVS: {final} (comp.out and comp.json in the project)", {final: result.final}), result.kind === "pass" ? "info" : "error");
        this.resultWindow.open();
        this.resultWindow.render();
    }

    // Load netgen the first time, with its built-in setup.
    async start() {
        if(this.session?.started) {
            return true;
        }
        const host = this.host;
        host.print(t("Loading netgen…"), "info");
        this.session = new Session({
            onOutput: (text, error) => {
                if(error) {
                    this.runner.noteError(text);
                }
                host.print(text, error ? "error" : null);
            },
        });
        const files = [];
        const response = await fetch(new URL("netgen/setups/scmos.tcl", import.meta.url));
        if(response.ok) {
            files.push({path: BUILT_IN_SETUP, data: new Uint8Array(await response.arrayBuffer())});
        }
        let ok = false;
        try {
            ok = await this.session.start(files);
        } catch(error) {
            host.print(t("Couldn't load netgen: {why}", {why: error.message || error}), "error");
            return false;
        }
        if(!ok) {
            host.print(t("netgen could not start."), "error");
            return false;
        }
        // The notice the GNU General Public License asks for when an interactive program starts.
        host.print(t("netgen, Copyright 1990, 1991, 2002, 2004, 2005 Massimo A. Sivilotti, Caltech, and R. Timothy Edwards, " +
            "MultiGiG, Inc., changed for this WebAssembly build in 2026. netgen comes with ABSOLUTELY NO WARRANTY. It is free " +
            "software: you may redistribute it under the terms of the GNU General Public License; About > netgen license shows a copy."),
        "info");
        return true;
    }

    // The window's layout, with its schematic and setup, to the netgen app in a new tab,
    // which compares them there.
    async sendToNetgen(wid) {
        const host = this.host, circuits = this.prepare(wid, []);
        if(!circuits) {
            return;
        }
        const {cell, layout, schematic, schematicCell, setup} = circuits;
        const paths = [layout, schematic, ...(setup === BUILT_IN_SETUP ? [] : [setup])];
        const project = {name: `${cell}_lvs`, files: paths.map(path => ({path, data: this.read(path)})),
            compare: {circuit1: [layout, cell], circuit2: [schematic, schematicCell], setup, blackbox: false}};
        host.print(t("Sending {files} to the netgen app, in a new tab.", {files: paths.join(", ")}), "info");
        try {
            await sendProject(appUrl("netgen", new URL("netgen/", import.meta.url)), "magic", project);
        } catch(error) {
            host.print(t("Couldn't send them: {why}", {why: error.message}), "error");
        }
    }

    stop() {
        this.session?.stop();
    }
}
