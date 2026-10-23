// SPDX-License-Identifier: GPL-2.0-or-later
// Simulation with IRSIM from the Magic page.
//
// Magic's own simulator commands work as on the desktop, through the bridge
// in rsim.js:
//   startrsim [options] prm file.sim   start IRSIM and stay in Magic
//   rsim [options] prm file.sim        start it (if needed) and go to the
//                                      irsim> prompt: "." returns to Magic,
//                                      "q" quits the simulator
//   simcmd cmd                         apply an IRSIM command to the selection
//   the rsim tool (space)              middle button: node values (1, 0, X)
//                                      of the selected paint, on the layout
// The page adds the Tcl integration's commands (the irsim procedures that
// IRSIM's irsim.tcl defines for Magic):
//   irsim [prm] [cell]                 extract and ext2sim if needed, then
//                                      start IRSIM and go to its prompt
//   watchnode [node...]                label the node(s) (default: the
//                                      selected paint) with their value, kept
//                                      up to date, and show them in the analyzer
//   unwatchnode node...                stop
//   watchtime                          open the analyzer
// The analyzer and the node lists are the IRSIM app's (the irsim submodule), fed by
// the same IRSIM.

import {RsimBridge} from "./rsim.js";
import {Analyzer} from "./irsim/analyzer.js";
import {TraceManager} from "./irsim/tracemgr.js";
import {appUrl, sendProject} from "./handoff.js";
import {t, register} from "./i18n.js";

// The page's messages about IRSIM in Japanese (i18n.js); IRSIM's own output stays as it is.
register({
    "Loading IRSIM…": "IRSIM を読み込み中…",
    "IRSIM 9.7, Copyright (C) 1988, 1990 Stanford University, changed for this WebAssembly build in 2026. IRSIM comes with ABSOLUTELY NO WARRANTY. It is free software: you may redistribute it under the terms of the GNU General Public License; About > IRSIM license shows a copy.":
        "IRSIM 9.7、Copyright (C) 1988, 1990 Stanford University。2026 年にこの WebAssembly 版のために変更されています。IRSIM は完全に無保証です。IRSIM はフリーソフトウェアであり、GNU 一般公衆利用許諾書（GPL）の条件のもとで再頒布できます。その写しは「情報」>「IRSIM のライセンス」にあります。",
    "Couldn't load IRSIM: {why}": "IRSIM を読み込めませんでした：{why}",
    "IRSIM is already running; at the irsim> prompt, q quits it.": "IRSIM はすでに実行中です。irsim> プロンプトで q と入力すると終了します。",
    "Load a cell first.": "先にセルを読み込んでください。",
    'IRSIM is running on {sim}. Commands now go to IRSIM (h, l, s, ana…); "." returns to Magic, where simcmd, the rsim tool (space) and watchnode use it; "q" quits.':
        "IRSIM が {sim} で実行中です。コマンドは IRSIM に送られます（h, l, s, ana…）。「.」で Magic に戻ると、simcmd、rsim ツール（space）、watchnode で IRSIM を使えます。「q」で終了します。",
    "IRSIM's supplies are Vdd and Gnd; drive this cell's with h/l first (e.g. {examples}).":
        "IRSIM の電源は Vdd と Gnd です。このセルの電源は、先に h/l で駆動してください（例：{examples}）。",
    "Magic didn't write {file}; see the messages above.": "Magic は {file} を書き出しませんでした。上のメッセージを見てください。",
    "Sending {files} to the IRSIM app, in a new tab (parameters {prm}).": "{files} を新しいタブの IRSIM アプリに送ります（パラメーター {prm}）。",
    "Sending {files} to the IRSIM app, in a new tab (parameters {prm}, running {cmd}).":
        "{files} を新しいタブの IRSIM アプリに送ります（パラメーター {prm}、{cmd} を実行）。",
    "Couldn't send them: {why}": "送れませんでした：{why}",
    "IRSIM isn't running.": "IRSIM は実行されていません。",
    "Start IRSIM first (irsim, or rsim prm file.sim).": "先に IRSIM を起動してください（irsim、または rsim prm file.sim）。",
    "Select some paint first, or name the node: watchnode name.": "先にペイントを選択するか、ノードを指定してください：watchnode name。",
    "Watching {nodes}.": "{nodes} を監視しています。",
});

export class Simulation {
    // host: {magic, print, run(wid, line, quiet), capture(wid, line), projectRoot(), desktop, saveBlob,
    //        projectName, windowCell(), boxCenter(), setMode(on)}
    constructor(host) {
        this.host = host;
        this.watched = new Map();    // node -> element name
        this.rsimMode = false;
        this.bridge = new RsimBridge({
            get magic() {
                return host.magic;
            },
            print: (text, kind) => host.print(text, kind),
            projectRoot: () => host.projectRoot(),
            onMode: on => this.setMode(on),
            onStart: () => this.started(),
            onStop: () => this.stopped(),
            afterCommand: () => this.afterCommand(),
            analyzerCall: (op, args) => this.analyzer.handle(op, args, false),
        });
        const bridge = this.bridge;
        // The analyzer and trace manager ask an IRSIM app for a session; give them this one.
        const session = {
            get started() {
                return bridge.running;
            },
            busy: false,
            get time() {
                return bridge.time;
            },
            get unitsPerNs() {
                return bridge.unitsPerNs;
            },
            history: async (names, since) => bridge.history(names, since),
            names: async () => bridge.names(),
        };
        const app = {
            desktop: host.desktop,
            print: host.print,
            saveBlob: host.saveBlob,
            get projectName() {
                return host.projectName();
            },
            session,
            run: line => this.irsimCommand(line),
            openTraceManager: () => this.traceManager.open(),
        };
        this.analyzer = app.analyzer = new Analyzer(app);
        this.traceManager = app.traceManager = new TraceManager(app);
    }

    get running() {
        return this.bridge.running;
    }

    // ----- Lifecycle

    started() {
        this.analyzer.reset();
        this.traceManager.reload();
    }

    stopped() {
        for(const element of this.watched.values()) {
            this.host.run(-1, `element delete ${element}`, true);
        }
        this.watched.clear();
        this.analyzer.reset();
        this.analyzer.close();
        this.traceManager.close();
        this.setMode(false);
    }

    setMode(on) {
        this.rsimMode = on;
        this.host.setMode(on);
    }

    // A new project: the old .sim no longer matches the layout.
    projectChanged() {
        if(this.running) {
            this.host.run(-1, "rsim", true);       // Enter the loop only to quit it
            this.line("q");
        }
    }

    // After any IRSIM command: redraw the analyzer, update watched nodes.
    afterCommand() {
        this.analyzer.scheduleRefresh();
        this.updateWatched();
    }

    // ----- Commands

    // Page-level handling of a command line typed in Magic.  Returns a promise if the page
    // took the command (or must load IRSIM first), otherwise null.
    frontEnd(wid, line) {
        const [cmd, ...args] = line.trim().split(/\s+/);
        if(cmd === "irsim") {
            return this.irsim(wid, args);
        }
        if(cmd === "watchnode") {
            return Promise.resolve(this.watchnode(wid, args));
        }
        if(cmd === "unwatchnode") {
            return Promise.resolve(this.unwatchnode(args));
        }
        if(cmd === "watchtime") {
            this.analyzer.open();
            return Promise.resolve();
        }
        if((cmd === "startrsim" || cmd === "rsim") && args.length && !this.running) {
            return this.load().then(() => this.host.run(wid, line, true));
        }
        return null;
    }

    async load() {
        if(!this.bridge.running) {
            this.host.print(t("Loading IRSIM…"), "info");
            try {
                await this.bridge.load();
                if(!this.announced) {
                    // The notice the GNU General Public License asks for when an interactive program starts.
                    this.announced = true;
                    this.host.print(t("IRSIM 9.7, Copyright (C) 1988, 1990 Stanford University, changed for this WebAssembly " +
                        "build in 2026. IRSIM comes with ABSOLUTELY NO WARRANTY. It is free software: you may redistribute it " +
                        "under the terms of the GNU General Public License; About > IRSIM license shows a copy."), "info");
                }
            } catch(error) {
                this.host.print(t("Couldn't load IRSIM: {why}", {why: error.message || error}), "error");
                throw error;
            }
        }
    }

    // The irsim command of IRSIM's Tcl integration: extract and ext2sim when needed, then start.
    async irsim(wid, [prm = "scmos100", cellArg]) {
        if(this.running) {
            this.host.print(t("IRSIM is already running; at the irsim> prompt, q quits it."), "info");
            this.host.run(wid, "rsim", true);
            return;
        }
        let sim;
        if(cellArg && /\.sim$/.test(cellArg)) {
            sim = cellArg;
        } else {
            const cell = cellArg || this.host.windowCell();
            if(!cell) {
                this.host.print(t("Load a cell first."), "error");
                return;
            }
            sim = `${cell}.sim`;
            const exists = path => {
                try {
                    this.host.magic.FS.stat(`${this.host.projectRoot()}/${path}`);
                    return true;
                } catch(e) {
                    return false;
                }
            };
            if(!exists(sim)) {
                if(!exists(`${cell}.ext`)) {
                    this.host.run(wid, "extract all");
                }
                this.host.run(wid, `ext2sim ${cell}`);
            }
        }
        await this.load();
        this.host.run(wid, `startrsim ${prm} ${sim}`);
        if(this.running) {
            this.host.print(t("IRSIM is running on {sim}. Commands now go to IRSIM (h, l, s, ana…); " +
                '"." returns to Magic, where simcmd, the rsim tool (space) and watchnode use it; "q" quits.', {sim}), "info");
            // IRSIM's supplies are Vdd and Gnd; a cell labelled otherwise needs them driven.
            const nodes = this.bridge.names().nodes.split(/\s+/);
            const supplies = nodes.filter(n => /^(vdd|vcc|gnd|vss)!?$/i.test(n) && !/^(Vdd|Gnd)$/.test(n));
            if(supplies.length) {
                this.host.print(t("IRSIM's supplies are Vdd and Gnd; drive this cell's with h/l first (e.g. {examples}).",
                    {examples: supplies.map(n => (/^v(dd|cc)/i.test(n) ? "h " : "l ") + n).join(", ")}), "info");
            }
            this.host.run(wid, "rsim", true);
        }
    }

    // The window's cell, extracted afresh to <cell>.sim, to the IRSIM app in a new tab, with
    // the project's command (.cmd) and parameter (.prm) files.  The app runs <cell>.cmd if there
    // is one, with the parameters IRSIM last started with here (scmos100 if it hasn't).
    async sendToIrsim(wid) {
        const host = this.host, cell = host.windowCell();
        if(!cell) {
            host.print(t("Load a cell first."), "error");
            return;
        }
        host.run(wid, "extract all", false);
        host.run(wid, `ext2sim ${cell}`, false);
        const fs = host.magic.FS, root = host.projectRoot(), sim = `${cell}.sim`;
        const read = path => fs.readFile(`${root}/${path}`);
        let files;
        try {
            files = [{path: sim, data: read(sim)}, ...fs.readdir(root).filter(p => /\.(cmd|prm)$/i.test(p)).map(path => ({path, data: read(path)}))];
        } catch(e) {
            host.print(t("Magic didn't write {file}; see the messages above.", {file: sim}), "error");
            return;
        }
        const prm = (this.bridge.lastArgs || "").split(/\s+/).find(a => a && !a.startsWith("-") && !/\.sim$/i.test(a)) || "scmos100";
        const cmd = files.some(f => f.path === `${cell}.cmd`) ? `${cell}.cmd` : "";
        host.print(t(cmd ? "Sending {files} to the IRSIM app, in a new tab (parameters {prm}, running {cmd})." :
            "Sending {files} to the IRSIM app, in a new tab (parameters {prm}).", {files: files.map(f => f.path).join(", "), prm, cmd}), "info");
        try {
            await sendProject(appUrl("irsim", new URL("irsim/", import.meta.url)), "magic", {name: cell, files, setup: {prm, cmd}});
        } catch(error) {
            host.print(t("Couldn't send them: {why}", {why: error.message}), "error");
        }
    }

    // A line typed at the irsim> prompt.
    line(text) {
        const [cmd] = text.trim().split(/\s+/);
        if(cmd === "watchnode" || cmd === "unwatchnode" || cmd === "watchtime") {
            return this.frontEnd(-1, text);
        }
        const stay = this.host.magic.ccall("magic_web_rsim_line", "number", ["string"], [text.trim()]);
        if(!stay) {
            this.setMode(false);
        }
        return null;
    }

    // A command from the analyzer or the trace manager (ana, clear…).
    irsimCommand(line) {
        if(!this.running) {
            this.host.print(t("IRSIM isn't running."), "error");
            return;
        }
        this.host.print("irsim> " + line, "command");
        for(const out of this.bridge.command(line)) {
            this.host.print(out);
        }
        this.afterCommand();
        if(/^\s*(ana|analyzer|vector|clear)\b/.test(line)) {
            this.traceManager.reload();
        }
    }

    // ----- Watched nodes

    nodeValue(node) {
        const text = this.bridge.command(`d ${node}`).join(" ");
        const m = new RegExp(`(?:^|\\s)${node.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=(\\S+)`).exec(text) || /=(\S+)/.exec(text);
        return m ? m[1] : "?";
    }

    watchnode(wid, nodes) {
        if(!this.running) {
            this.host.print(t("Start IRSIM first (irsim, or rsim prm file.sim)."), "error");
            return;
        }
        if(!nodes.length) {
            // getnode prints "node name : X" for each selected node.
            nodes = this.host.capture(wid, "getnode").map(l => /:\s*(.*)$/.exec(l)).filter(Boolean)
                .flatMap(m => m[1].trim().split(/\s+/)).filter(Boolean);
            if(!nodes.length) {
                this.host.print(t("Select some paint first, or name the node: watchnode name."), "error");
                return;
            }
        }
        const [x, y] = this.host.boxCenter();
        nodes.forEach((node, i) => {
            const clean = node.replace(/#$/, "");
            const element = "irsim_" + clean.replace(/[^\w]/g, "_");
            if(!this.watched.has(clean)) {
                this.host.run(wid, `element add text ${element} white ${x} ${y - 4 * i} "${clean}=${this.nodeValue(clean)}"`, true);
                this.watched.set(clean, element);
            }
            this.bridge.command(`ana ${clean}`);
        });
        this.host.print(t("Watching {nodes}.", {nodes: nodes.join(" ")}), "info");
        this.afterCommand();
    }

    unwatchnode(nodes) {
        for(const node of nodes) {
            const clean = node.replace(/#$/, "");
            const element = this.watched.get(clean);
            if(element) {
                this.host.run(-1, `element delete ${element}`, true);
                this.watched.delete(clean);
            }
            this.analyzer.removeTrace(clean);
        }
    }

    updateWatched() {
        if(!this.running) {
            return;
        }
        for(const [node, element] of this.watched) {
            this.host.run(-1, `element configure ${element} text "${node}=${this.nodeValue(node)}"`, true);
        }
    }
}
