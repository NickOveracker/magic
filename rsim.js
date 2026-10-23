// SPDX-License-Identifier: GPL-2.0-or-later
// IRSIM for Magic's simulator commands (rsim, startrsim, simcmd, the rsim
// tool) in the web build.
//
// Desktop Magic starts IRSIM as a process and talks to it through pipes
// (sim/SimRsim.c).  Here IRSIM is a second WebAssembly module on the page,
// from the irsim submodule (irsim/irsim.js), and this object stands
// in for the pipes: Magic's C code calls start(), write(), read(), stop()
// and mode() through Module.magicRsim.  write() runs each command line in
// IRSIM at once and queues what it printed followed by its prompt, so Magic
// reads the reply exactly as it would from the pipe.
//
// IRSIM is loaded only when a simulator command first needs it, and dropped
// again when the simulator quits, as the desktop process would be.

const IRSIM_DIR = new URL("irsim/", import.meta.url);
const PRM_DIR = new URL("irsim/src/lib/prm/", import.meta.url);
const PRMS = ["scmos100", "scmos30", "scmos35", "scmos50_3v", "scmos50_5v", "scmos60", "scmos1_6um", "scmos2um",
    "amiabn.80.n99z.5", "amic5.30.n98s.3.3", "amicwl.50.n97l.5", "hpcmos10.20.n98v.3.3", "hpcmos14.30.n9ae.3.3",
    "hpcmos26.40.n88x.5", "orbit.60.n96e.5", "tsmc18.10.nxxx.1.8", "tsmc25.15.n99y.2.5", "tsmc35.20.n98t.3.3",
    "tsmc35p.20.n98tp.3.3"];
const PROMPT = "irsim> ";

let factory = null;              // createIrsim, once irsim.js has loaded

function loadScript(url) {
    return new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = url;
        script.onload = resolve;
        script.onerror = () => reject(new Error(`Couldn't load ${url}`));
        document.head.appendChild(script);
    });
}

export class RsimBridge {
    // host: {magic (the Magic module), print(text, kind), projectRoot(), onMode(on), onStart(), onStop(),
    //        analyzerCall(op, args)}
    constructor(host) {
        this.host = host;
        this.irsim = null;           // The running IRSIM module, or null
        this.spare = null;           // A loaded, not yet started instance
        this.prms = null;
        this.queue = [];             // Bytes waiting for Magic to read
        this.output = null;          // Lines IRSIM prints while a command runs
        this.loading = null;
        this.unitsPerNs = 1000;
    }

    get running() {
        return Boolean(this.irsim);
    }

    // Fetch IRSIM and the parameter files, and get an instance ready to start.
    load() {
        if(this.spare || this.irsim) {
            return Promise.resolve();
        }
        if(!this.loading) {
            this.loading = (async () => {
                if(!factory) {
                    await loadScript(new URL("irsim.js", IRSIM_DIR));
                    factory = window.createIrsim;
                }
                if(!this.prms) {
                    this.prms = [];
                    await Promise.all(PRMS.map(async name => {
                        const response = await fetch(new URL(name + ".prm", PRM_DIR));
                        if(response.ok) {
                            this.prms.push({name, data: new Uint8Array(await response.arrayBuffer())});
                        }
                    }));
                }
                this.spare = await factory({
                    locateFile: path => new URL(path, IRSIM_DIR).href,
                    print: text => this.printed(text),
                    printErr: text => this.printed(text),
                });
            })().finally(() => {
                this.loading = null;
            });
        }
        return this.loading;
    }

    printed(text) {
        if(this.output) {
            this.output.push(text);
        } else {
            this.host.print(text);
        }
    }

    enqueue(text) {
        this.queue.push(...new TextEncoder().encode(text));
    }

    // ----- Called from sim/SimRsim.c

    // args: IRSIM's command line, e.g. "scmos100 adder.sim".  Returns 0 if IRSIM started.
    start(args) {
        if(this.irsim) {
            return -1;
        }
        if(!this.spare) {
            this.host.print("IRSIM is still loading; give the command again in a moment.", "error");
            this.load();
            return -1;
        }
        const irsim = this.irsim = this.spare;
        this.spare = null;
        this.lastArgs = args;
        const fs = irsim.FS, magicFs = this.host.magic.FS, root = this.host.projectRoot();
        const mkdirs = path => {
            let dir = "";
            for(const part of path.split("/").filter(Boolean).slice(0, -1)) {
                dir += "/" + part;
                try {
                    fs.mkdir(dir);
                } catch(e) {
                    // Exists already
                }
            }
        };
        // Parameter files where IRSIM looks for them by name ($CAD/irsim/prm), the files
        // named on the command line, and the project's command files (for "@ file.cmd"),
        // copied from Magic's working folder.
        for(const prm of this.prms) {
            mkdirs(`/irsim/irsim/prm/${prm.name}.prm`);
            fs.writeFile(`/irsim/irsim/prm/${prm.name}.prm`, prm.data);
        }
        fs.mkdir("/work");
        for(const arg of args.split(/\s+/).filter(a => a && !a.startsWith("-"))) {
            for(const path of [arg, arg + ".prm"]) {
                try {
                    const data = magicFs.readFile(path.startsWith("/") ? path : `${root}/${path}`);
                    mkdirs("/work/" + path.replace(/^\//, ""));
                    fs.writeFile("/work/" + path.replace(/^\//, ""), data);
                    break;
                } catch(e) {
                    // Not in Magic's folder: IRSIM looks for it itself
                }
            }
        }
        for(const name of magicFs.readdir(root).filter(n => /\.cmd$/i.test(n))) {
            try {
                fs.writeFile("/work/" + name, magicFs.readFile(`${root}/${name}`));
            } catch(e) {
                // Unreadable: IRSIM reports it if the file is used
            }
        }
        fs.chdir("/work");
        irsim.irsimAna = new Proxy({}, {get: (_, op) => (...a) => this.host.analyzerCall(op, a)});
        this.queue = [];
        this.output = [];
        let ok;
        try {
            ok = irsim.ccall("irsim_web_start_line", "number", ["string"], [args]) === 0;
            this.unitsPerNs = irsim.ccall("irsim_web_units_per_ns", "number", [], []);
        } catch(e) {
            ok = false;
        }
        const lines = this.output;
        this.output = null;
        if(!ok) {
            for(const line of lines) {
                this.host.print(line, "error");
            }
            this.irsim = null;
            return -1;
        }
        this.enqueue(lines.map(l => l + "\n").join("") + PROMPT);
        setTimeout(() => this.host.onStart(), 0);
        return 0;
    }

    // Command lines from Magic: run each, queue its output and the prompt.
    write(text) {
        if(!this.irsim) {
            return -1;
        }
        for(const line of text.split("\n").filter(l => l.trim())) {
            this.enqueue(this.command(line).map(l => l + "\n").join("") + PROMPT);
        }
        setTimeout(() => this.host.afterCommand(), 0);
        return text.length;
    }

    // Copy up to max queued bytes into Magic's memory at ptr.
    read(ptr, max) {
        const n = Math.min(max, this.queue.length);
        this.host.magic.HEAPU8.set(this.queue.splice(0, n), ptr);
        return n;
    }

    stop() {
        if(this.irsim) {
            this.irsim = null;
            this.queue = [];
            this.host.print("IRSIM stopped.", "info");
            setTimeout(() => this.host.onStop(), 0);
        }
    }

    mode(on) {
        this.host.onMode(Boolean(on));
    }

    // ----- Used by the page (analyzer, watched nodes)

    // Run one command in IRSIM and return what it printed.
    command(line) {
        if(!this.irsim) {
            return [];
        }
        this.output = [];
        try {
            this.irsim.ccall("irsim_web_command", "number", ["string"], [line]);
        } catch(e) {
            // IRSIM exited (exit command) or crashed: Magic sees the pipe close.
            this.output.push(`IRSIM stopped: ${e.message || e}`);
            this.irsim = null;
            setTimeout(() => this.host.onStop(), 0);
        }
        const lines = this.output;
        this.output = null;
        return lines;
    }

    get time() {
        return this.irsim ? this.irsim.ccall("irsim_web_time", "number", [], []) : 0;
    }

    history(names, since) {
        return this.irsim ? this.irsim.ccall("irsim_web_history", "string", ["string", "number"], [names.join(" "), since]) : "";
    }

    names() {
        if(!this.irsim) {
            return {nodes: "", vectors: ""};
        }
        return {nodes: this.irsim.ccall("irsim_web_nodes", "string", [], []),
            vectors: this.irsim.ccall("irsim_web_vectors", "string", [], [])};
    }
}
