// Magic in the browser: starts the WebAssembly build with the WEB display
// driver, wires the page's controls to it, and loads projects.

import createMagic from "./magic.js";
import {CanvasDriver} from "./canvas-driver.js";
import {readArchive, isArchive, stripCommonFolder, cleanPath, writeTarGz} from "./archive.js";
import {Gui} from "./wrapper.js";

const $ = selector => document.querySelector(selector);
const desktop = $("#desktop");
const log = $("#log");
const commandInput = $("#command");
const status = $("#status");

const DEMOS = {
    full_adder_path: "Mirror full adder, sized for speed (default)",
    add2x_path: "2-bit adder block, sized for speed",
    mult4_path: "4×4 multiplier, sized for speed",
    mult4: "4×4 multiplier",
    add2x: "2-bit adder block",
    full_adder: "Mirror full adder",
    c_element: "C-element",
    inverter: "Inverter",
};
const DEFAULT_DEMO = "full_adder_path";
const BUILT_IN_TECHS = ["scmos", "minimum"];

let magic = null;            // The Emscripten module
let project = null;          // {name, root, top}
let activeWindow = -1;       // Window that typed commands go to (-1: topmost layout window)
let capture = null;          // Collects output while a command's result is being read

// ----- Output

function print(textLine, kind) {
    // Output read back by the page (cellname lists, style queries) stays out of the console.
    if(capture) {
        capture.push(textLine);
        return;
    }
    const line = document.createElement("div");
    line.className = "log-line" + (kind ? " log-" + kind : "");
    line.textContent = textLine;
    const atBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 4;
    log.appendChild(line);
    while(log.childElementCount > 2000) {
        log.firstElementChild.remove();
    }
    if(atBottom) {
        log.scrollTop = log.scrollHeight;
    }
}

function setStatus(message) {
    status.textContent = message;
}

// ----- Running Magic

let pumpQueued = false;

// Run the commands that queued mouse and key events produced, once per frame.
function schedulePump() {
    if(pumpQueued || !magic) {
        return;
    }
    pumpQueued = true;
    requestAnimationFrame(() => {
        pumpQueued = false;
        guard(() => magic._magic_web_pump());
        scheduleDrc();
        gui.scheduleUpdate();
    });
}

// Background DRC in short slices, so the page stays responsive.
let drcTimer = null;
function scheduleDrc() {
    if(drcTimer !== null || !magic) {
        return;
    }
    drcTimer = setTimeout(function step() {
        const busy = guard(() => magic._magic_web_drc_step(12));
        setStatus(busy ? "Checking design rules…" : readyText());
        drcTimer = busy ? setTimeout(step, 0) : null;
        if(!busy) {
            gui.scheduleUpdate();
        }
    }, 20);
}

function readyText() {
    return project ? `${project.name}: ${project.top}` : "Ready";
}

function guard(fn) {
    try {
        return fn();
    } catch(error) {
        fatal(error);
        return 0;
    }
}

function fatal(error) {
    console.error(error);
    print(`Magic stopped: ${error.message || error}. Reload the page to start again.`, "error");
    setStatus("Stopped");
    magic = null;
}

// Run a command line in window wid (-1: the topmost layout window), as if typed after ":".
function runIn(wid, command, quiet) {
    if(!magic) {
        return -1;
    }
    if(!quiet) {
        print(": " + command, "command");
    }
    const result = guard(() => magic.ccall("magic_web_command", "number", ["number", "string"], [wid, command]));
    scheduleDrc();
    gui.scheduleUpdate();
    return result;
}

// Run a command line in the active window.
function run(command, quiet) {
    return runIn(activeWindow, command, quiet);
}

// Run a command and return what it printed.
function captureIn(wid, command) {
    capture = [];
    try {
        runIn(wid, command, true);
        return capture;
    } finally {
        capture = null;
    }
}

function runCapture(command) {
    return captureIn(activeWindow, command);
}

// Call one of the magic_web_* queries; most return text.
function query(name, args) {
    if(!magic) {
        return "";
    }
    const numeric = name === "magic_web_layer_icon";
    return guard(() => magic.ccall(name, numeric ? "number" : "string",
        args.map(a => typeof a === "number" ? "number" : "string"), args)) || "";
}

// ----- Files

function mkdirs(path) {
    let dir = "";
    for(const part of path.split("/").slice(0, -1)) {
        dir += "/" + part;
        try {
            magic.FS.mkdir(dir);
        } catch(e) {
            // Exists already
        }
    }
}

function listFiles(root, prefix = "") {
    const files = [];
    for(const name of magic.FS.readdir(root)) {
        if(name === "." || name === "..") {
            continue;
        }
        const path = root + "/" + name;
        if(magic.FS.isDir(magic.FS.stat(path).mode)) {
            files.push(...listFiles(path, prefix + name + "/"));
        } else {
            files.push({path: prefix + name, data: magic.FS.readFile(path)});
        }
    }
    return files;
}

const textDecoder = new TextDecoder();

// The cell to open: a .mag file that no other cell uses, preferring one named after the project.
function chooseTop(name, files) {
    const cells = files.filter(f => /\.mag$/i.test(f.path));
    const used = new Set();
    for(const cell of cells) {
        for(const m of textDecoder.decode(cell.data).matchAll(/^use\s+(\S+)/gm)) {
            used.add(m[1].split("/").pop());
        }
    }
    const base = f => f.path.split("/").pop().replace(/\.mag$/i, "");
    const roots = cells.filter(f => !used.has(base(f)));
    const pick = roots.find(f => base(f) === name) || roots.sort((a, b) => b.data.length - a.data.length)[0] ||
        cells[0];
    return pick ? pick.path.replace(/\.mag$/i, "") : null;
}

function techOf(file) {
    const m = /^tech\s+(\S+)/m.exec(textDecoder.decode(file.data.subarray(0, 512)));
    return m ? m[1] : null;
}

let projectCount = 0;
let currentTech = "scmos";

// Cell names listed by a cellname subcommand ("allcells", "topcells", "modified").
function cellNames(which) {
    return runCapture(`cellname ${which}`).filter(line => /^\s+\S/.test(line)).map(line => line.trim())
        .filter(name => name !== "(UNNAMED)");
}

// Unload every cell, so a new project's cells don't pick up same-named cells from the last one.
// Returns false if the user wants to keep unsaved changes.
function unloadAll() {
    const modified = cellNames("modified");
    if(modified.length && !window.confirm(`Discard unsaved changes in ${modified.join(", ")}?`)) {
        return false;
    }
    run("load", true);
    for(const cell of cellNames("allcells")) {
        run(`cellname delete ${cell} -noprompt`, true);
    }
    return true;
}

async function loadProject(name, files) {
    files = stripCommonFolder(files.filter(f => f.path));
    if(!files.length) {
        print("No files to load.", "error");
        return;
    }
    name = name.replace(/\.(zip|tar|tgz|tar\.gz|mag)$/i, "").replace(/[^\w.-]+/g, "_") || "project";
    if(project && !unloadAll()) {
        return;
    }
    const root = `/work/${++projectCount}-${name}`;
    for(const file of files) {
        mkdirs(root + "/" + file.path);
        magic.FS.writeFile(root + "/" + file.path, file.data);
    }
    magic.FS.chdir(root);
    print(`Loaded ${files.length} file${files.length === 1 ? "" : "s"} into ${root}`, "info");

    // Technology: the project's own .tech file, else the one its cells name.
    const techFile = files.find(f => /\.tech$/i.test(f.path));
    const top = chooseTop(name, files);
    const topFile = top && files.find(f => f.path === top + ".mag");
    const tech = techFile ? techFile.path : (topFile && techOf(topFile)) || "scmos";
    if(!techFile && !BUILT_IN_TECHS.includes(tech)) {
        print(`This build includes the scmos technology only; "${tech}" cells may not load. ` +
            "Add the .tech file to the project to use it.", "error");
    }
    if(techFile || tech !== currentTech) {
        run(`tech load ${tech} -noprompt`);
        currentTech = tech;
    }

    const gds = files.find(f => /\.(gds|gds2|gdsii|strm)$/i.test(f.path));
    if(top) {
        run(`load ${top}`);
        project = {name, root, top};
    } else if(gds) {
        run(`gds read ${gds.path}`);
        const topcells = cellNames("topcells");
        const cell = topcells[0];
        if(cell) {
            run(`load ${cell}`);
        }
        project = {name, root, top: cell || gds.path};
    } else {
        print("No .mag or .gds file found in the project.", "error");
        project = {name, root, top: "(nothing loaded)"};
    }
    run("select top cell", true);
    run("view", true);
    run("select clear", true);
    updateTitle();
    setStatus(readyText());
}

function updateTitle() {
    document.title = project ? `${project.top} · Magic` : "Magic";
}

// Files from <input type=file>, either picked one by one or as a folder.
async function filesFromInput(fileList) {
    const files = [];
    for(const file of fileList) {
        files.push({path: cleanPath(file.webkitRelativePath || file.name), data: new Uint8Array(await file.arrayBuffer())});
    }
    return files;
}

async function openFiles(fileList, folderName) {
    try {
        const list = Array.from(fileList);
        if(list.length === 1 && isArchive(list[0].name)) {
            const archive = list[0];
            setStatus(`Reading ${archive.name}…`);
            const files = await readArchive(archive.name, new Uint8Array(await archive.arrayBuffer()));
            await loadProject(archive.name, files);
            return;
        }
        const files = await filesFromInput(list);
        const name = folderName || (files.length === 1 ? files[0].path : files[0]?.path.split("/")[0]) || "project";
        await loadProject(name, files);
    } catch(error) {
        print(String(error.message || error), "error");
        setStatus(readyText());
    }
}

// Drag and drop: files, folders (via the entries API) or one archive.
async function readEntry(entry, prefix) {
    if(entry.isFile) {
        const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
        return [{path: cleanPath(prefix + file.name), data: new Uint8Array(await file.arrayBuffer())}];
    }
    const reader = entry.createReader(), files = [];
    for(;;) {
        const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
        if(!batch.length) {
            break;
        }
        for(const child of batch) {
            files.push(...await readEntry(child, prefix + entry.name + "/"));
        }
    }
    return files;
}

async function drop(event) {
    event.preventDefault();
    document.body.classList.remove("dragging");
    const items = Array.from(event.dataTransfer.items || []).filter(item => item.kind === "file");
    const entries = items.map(item => item.webkitGetAsEntry && item.webkitGetAsEntry()).filter(Boolean);
    if(entries.length === 1 && entries[0].isDirectory) {
        try {
            await loadProject(entries[0].name, await readEntry(entries[0], ""));
        } catch(error) {
            print(String(error.message || error), "error");
        }
        return;
    }
    await openFiles(event.dataTransfer.files);
}

async function download() {
    if(!project) {
        return;
    }
    run("writeall force");
    const files = listFiles(project.root);
    const blob = new Blob([await writeTarGz(files.map(f => ({path: project.name + "/" + f.path, data: f.data})))],
        {type: "application/gzip"});
    saveBlob(project.name + ".tar.gz", blob);
    print(`Saved ${files.length} file${files.length === 1 ? "" : "s"} to ${project.name}.tar.gz`, "info");
}

// Files of the current project, relative to its folder.
function projectFiles() {
    return project ? listFiles(project.root).map(f => f.path) : [];
}

function saveBlob(name, blob) {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 10000);
}

// Ask for files with a temporary <input type=file>.
function pickFiles(accept, multiple) {
    return new Promise(resolve => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = accept;
        input.multiple = multiple;
        input.addEventListener("change", () => resolve(Array.from(input.files)));
        input.click();
    });
}

// Copy picked files into the project folder without reloading it.
async function addToProject(files) {
    if(!project) {
        return [];
    }
    const added = [];
    for(const file of files) {
        const path = cleanPath(file.name);
        magic.FS.writeFile(project.root + "/" + path, new Uint8Array(await file.arrayBuffer()));
        added.push(path);
    }
    print(`Added ${added.join(", ")} to ${project.root}`, "info");
    return added;
}

const appForGui = {
    get driver() {
        return driver;
    },
    get project() {
        return project;
    },
    run: runIn,
    capture: captureIn,
    query,
    print,
    download,
    projectFiles,
    projectCells: () => projectFiles().filter(p => /\.mag$/i.test(p)).map(p => p.replace(/\.mag$/i, "")),
    projectTechs: () => projectFiles().filter(p => /\.tech$/i.test(p)).map(p => p.replace(/\.tech$/i, "")),
    async addFiles() {
        await addToProject(await pickFiles(".mag", true));
        gui.managers.library?.refresh();
    },
    async readGds(wid) {
        const [path] = await addToProject(await pickFiles(".gds,.gds2,.gdsii,.strm", false));
        if(path) {
            runIn(wid, `gds read ${path}`);
            const top = cellNames("topcells")[0];
            if(top) {
                runIn(wid, `load ${top}`);
            }
        }
    },
    downloadFile(path) {
        try {
            saveBlob(path.split("/").pop(), new Blob([magic.FS.readFile(path)]));
        } catch(e) {
            print(`${path} was not written.`, "error");
        }
    },
    saveText(name, text) {
        saveBlob(name, new Blob([text], {type: "text/plain"}));
    },
};

const gui = new Gui(appForGui);

async function loadDemo(name) {
    setStatus(`Loading ${name}…`);
    const response = await fetch(`demo/${name}.mag`);
    if(!response.ok) {
        throw new Error(`demo/${name}.mag: ${response.status}`);
    }
    await loadProject(name, [{path: name + ".mag", data: new Uint8Array(await response.arrayBuffer())}]);
}

// ----- Command line

const history = [];
let historyIndex = 0;

function openCommandLine(wid) {
    if(wid !== undefined && wid !== null) {
        activeWindow = wid;
    }
    $("#console").classList.remove("collapsed");
    commandInput.focus();
}

commandInput.addEventListener("keydown", event => {
    if(event.key === "Enter") {
        const command = commandInput.value.trim();
        commandInput.value = "";
        if(command) {
            history.push(command);
            historyIndex = history.length;
            run(command);
        }
        refocusCanvas();
    } else if(event.key === "Escape") {
        commandInput.value = "";
        refocusCanvas();
    } else if(event.key === "ArrowUp" && historyIndex > 0) {
        commandInput.value = history[--historyIndex];
        event.preventDefault();
    } else if(event.key === "ArrowDown") {
        historyIndex = Math.min(history.length, historyIndex + 1);
        commandInput.value = history[historyIndex] || "";
        event.preventDefault();
    }
});

function refocusCanvas() {
    const canvas = desktop.querySelector(".magic-canvas");
    const win = driver.windows.get(activeWindow) || driver.windows.values().next().value;
    (win ? win.canvas : canvas)?.focus({preventScroll: true});
}

// ----- Page controls

$("#open-files").addEventListener("click", () => $("#pick-files").click());
$("#open-folder").addEventListener("click", () => $("#pick-folder").click());
$("#pick-files").addEventListener("change", event => {
    openFiles(event.target.files);
    event.target.value = "";
});
$("#pick-folder").addEventListener("change", event => {
    const first = event.target.files[0];
    openFiles(event.target.files, first ? first.webkitRelativePath.split("/")[0] : null);
    event.target.value = "";
});
$("#download").addEventListener("click", () => download());

const demoSelect = $("#demo");
for(const [name, label] of Object.entries(DEMOS)) {
    demoSelect.add(new Option(label, name));
}
demoSelect.addEventListener("change", () => {
    if(demoSelect.value) {
        loadDemo(demoSelect.value).catch(error => print(String(error.message || error), "error"));
        demoSelect.value = "";
    }
});

$("#console-toggle").addEventListener("click", () => {
    const collapsed = $("#console").classList.toggle("collapsed");
    $("#console-toggle").setAttribute("aria-expanded", String(!collapsed));
});
function showHelp(show) {
    $("#help").hidden = !show;
    $("#help-toggle").setAttribute("aria-expanded", String(show));
}
$("#help-toggle").addEventListener("click", () => showHelp($("#help").hidden));
// Clicking anywhere else, or Escape, closes the help.
document.addEventListener("pointerdown", event => {
    if(!$("#help").hidden && !event.target.closest("#help, #help-toggle")) {
        showHelp(false);
    }
}, true);
document.addEventListener("keydown", event => {
    if(event.key === "Escape" && !$("#help").hidden) {
        showHelp(false);
        $("#help-toggle").focus();
    }
});

document.addEventListener("dragover", event => {
    event.preventDefault();
    document.body.classList.add("dragging");
});
document.addEventListener("dragleave", event => {
    if(!event.relatedTarget) {
        document.body.classList.remove("dragging");
    }
});
document.addEventListener("drop", drop);

new ResizeObserver(() => {
    if(magic) {
        magic._magic_web_screen(desktop.clientWidth, desktop.clientHeight);
    }
}).observe(desktop);

// ----- Start

const driver = new CanvasDriver(desktop, {
    onInput: schedulePump,
    onCommand: (wid, command) => {
        if(command === null) {
            openCommandLine(wid);
        } else {
            activeWindow = wid;
            run(command);
            activeWindow = -1;
        }
    },
    onFocusWindow: wid => {
        activeWindow = wid;
    },
    onMessage: message => print(message, "info"),
    onDecorate: win => gui.decorate(win),
    onPointer: win => gui.pointerMoved(win),
});

async function start() {
    setStatus("Loading Magic…");
    const [module, magicrc] = await Promise.all([
        createMagic({
            magicWeb: driver,
            noInitialRun: true,
            print: line => print(line),
            printErr: line => print(line, "error"),
            onAbort: reason => fatal(new Error(String(reason))),
        }),
        fetch("magicrc").then(r => r.text()),
    ]);
    magic = module;
    driver.module = module;
    magic.FS.writeFile("/magic/sys/.magicrc", magicrc);
    mkdirs("/work/x");

    if(magic.ccall("magic_web_init", "number", ["string"], ["scmos"]) !== 0) {
        throw new Error("Magic failed to start");
    }
    const demo = new URLSearchParams(location.search).get("demo") || DEFAULT_DEMO;
    await loadDemo(DEMOS[demo] ? demo : DEFAULT_DEMO);
    gui.scheduleUpdate();
    refocusCanvas();
}

start().catch(fatal);

// For tests and the console.
window.magicApp = {run, runIn, runCapture, query, loadProject, gui, get module() {
    return magic;
}, driver, get project() {
    return project;
}};
