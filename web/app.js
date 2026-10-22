// Magic in the browser: starts the WebAssembly build with the WEB display
// driver, wires the page's controls to it, and loads projects.

import createMagic from "./magic.js";
import {CanvasDriver} from "./canvas-driver.js";
import {readArchive, isArchive, stripCommonFolder, cleanPath, writeTarGz} from "./archive.js";
import {Gui} from "./wrapper.js";
import {menuBar, closeMenus} from "./menu.js";
import {setHomeFocus} from "./dialog.js";
import {diskSupported, DiskStore, BrowserStore, recentProjects, reopen, forget} from "./storage.js";

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
        scheduleSync();
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
    if(!project) {
        return "Ready";
    }
    const where = project.store ? (project.syncError ? ` · not saved to ${project.store.label}!` :
        ` · kept in ${project.store.label}`) : " · in memory only";
    return `${project.name}: ${project.top}${where}`;
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
    scheduleSync();
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

async function loadProject(name, files, store = null) {
    files = store ? files.filter(f => f.path) : stripCommonFolder(files.filter(f => f.path));
    if(!files.length && !store) {
        print("No files to load.", "error");
        return false;
    }
    name = name.replace(/\.(zip|tar|tgz|tar\.gz|mag)$/i, "").replace(/[^\w.-]+/g, "_") || "project";
    if(project && !unloadAll()) {
        return false;
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
    if(!top && !gds && store) {
        run("load", true);
    }
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
        print(store ? "The folder has no .mag or .gds files yet; Magic's saves will go into it." :
            "No .mag or .gds file found in the project.", store ? "info" : "error");
        project = {name, root, top: "(nothing loaded)"};
    }
    project.store = store;
    project.synced = fileTimes(root);
    run("select top cell", true);
    run("view", true);
    run("select clear", true);
    updateTitle();
    setStatus(readyText());
    return true;
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

// ----- Keeping projects (storage.js)

// Modification times of the files under root: path -> ms.
function fileTimes(root, prefix = "", times = new Map()) {
    for(const name of magic.FS.readdir(root)) {
        if(name === "." || name === "..") {
            continue;
        }
        const path = root + "/" + name, stat = magic.FS.stat(path);
        if(magic.FS.isDir(stat.mode)) {
            fileTimes(path, prefix + name + "/", times);
        } else {
            times.set(prefix + name, stat.mtime.getTime());
        }
    }
    return times;
}

let syncTimer = null, syncing = false, syncAgain = false;

// Copy the files Magic wrote (save, writeall, extract, gds write...) into the project's store.
function scheduleSync() {
    if(!project || !project.store || syncTimer) {
        return;
    }
    syncTimer = setTimeout(() => {
        syncTimer = null;
        syncProject();
    }, 300);
}

async function syncProject() {
    if(!project || !project.store) {
        return;
    }
    if(syncing) {
        syncAgain = true;
        return;
    }
    syncing = true;
    const current = project;
    try {
        const times = fileTimes(current.root);
        const written = [];
        for(const [path, time] of times) {
            if(current.synced.get(path) !== time) {
                await current.store.write(path, magic.FS.readFile(current.root + "/" + path));
                current.synced.set(path, time);
                written.push(path);
            }
        }
        current.syncError = null;
        if(written.length) {
            print(`Saved ${written.join(", ")} to ${current.store.label}`, "info");
        }
    } catch(error) {
        current.syncError = error;
        print(`Couldn't save to ${current.store.label}: ${error.message || error}`, "error");
    } finally {
        syncing = false;
        if(current === project) {
            setStatus(readyText());
        }
        if(syncAgain) {
            syncAgain = false;
            syncProject();
        }
    }
}

let recent = [];

async function refreshRecent() {
    recent = await recentProjects();
}

async function openStore(store) {
    setStatus(`Reading ${store.label}…`);
    const files = await store.readAll();
    if(await loadProject(store.name, files, store)) {
        print(`Working in ${store.label}: Magic's saves go there.`, "info");
    }
    refreshRecent();
}

// Give the current (in-memory) project a store, writing all its files into it.
async function keepProject(store) {
    if(!project) {
        return;
    }
    run("writeall force", true);
    project.store = store;
    project.synced = new Map();
    await syncProject();
    refreshRecent();
}

async function attempt(work) {
    try {
        await work();
    } catch(error) {
        if(error && error.name === "AbortError") {
            return;                  // The user cancelled a picker
        }
        print(String(error.message || error), "error");
        setStatus(readyText());
    }
}

const NEEDS_CHROMIUM = "Needs Chrome, Edge or another Chromium browser (the File System Access API)";

function projectMenu() {
    const items = [
        {label: "Open files…", action: () => $("#pick-files").click()},
        {label: "Open folder (copy)…", action: () => $("#pick-folder").click()},
        "-",
        {label: "Work in a folder on disk…", disabled: !diskSupported, title: diskSupported ?
            "Open a folder; files Magic writes are saved into it" : NEEDS_CHROMIUM,
        action: () => attempt(async () => openStore(await DiskStore.pick()))},
        {label: "Save project to a folder on disk…", disabled: !diskSupported || !project, title: diskSupported ?
            "Copy this project into a folder and keep working there" : NEEDS_CHROMIUM,
        action: () => attempt(async () => keepProject(await DiskStore.pick()))},
        {label: "Keep project in browser storage", disabled: !project || project.store instanceof BrowserStore,
            title: "Saves into this browser (private to this site) and keeps it there",
            action: () => attempt(async () => keepProject(await BrowserStore.create(project.name)))},
    ];
    if(recent.length) {
        items.push("-");
        for(const entry of recent.slice(0, 8)) {
            items.push({label: `Reopen ${entry.name} (${entry.kind === "disk" ? "folder" : "browser storage"})`,
                action: () => attempt(async () => openStore(await reopen(entry)))});
        }
        items.push({label: "Forget recent projects…", action: () => attempt(async () => {
            const stored = recent.filter(e => e.kind === "browser").map(e => e.name);
            const warning = stored.length ? ` This deletes ${stored.join(", ")} from browser storage.` : "";
            if(window.confirm(`Forget the recent projects?${warning} Folders on disk are not touched.`)) {
                for(const entry of recent) {
                    await forget(entry.id);
                }
                await refreshRecent();
            }
        })});
    }
    items.push("-", {label: "Download project (.tar.gz)", disabled: !project, action: () => download()});
    return items;
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

// Give the keyboard to the active layout window, or another visible one.  If none can take it,
// at least take it away from the control that has it, so Magic's keys don't press that again.
function refocusCanvas() {
    const visible = w => w && !w.fw.geometry.collapsed;
    const win = [driver.windows.get(activeWindow), ...driver.windows.values()].find(visible);
    if(win) {
        win.canvas.focus({preventScroll: true});
    }
    if(!win || document.activeElement !== win.canvas) {
        document.activeElement?.blur?.();
    }
}

// ----- Page controls

$("#pick-files").addEventListener("change", event => {
    openFiles(event.target.files);
    event.target.value = "";
});
$("#pick-folder").addEventListener("change", event => {
    const first = event.target.files[0];
    openFiles(event.target.files, first ? first.webkitRelativePath.split("/")[0] : null);
    event.target.value = "";
});
const demoMenu = Object.entries(DEMOS).map(([name, label]) => ({label, action: () =>
    loadDemo(name).catch(error => print(String(error.message || error), "error"))}));
$("#top-menus").appendChild(menuBar([["Project", projectMenu], ["Demos", demoMenu]], "Page menu",
    {onDone: () => refocusCanvas()}));

// Buttons, check boxes and drop-downs used with the mouse give the keyboard back to the layout
// window afterwards, so that Magic's keys (space, letters) don't press them again.  Used with
// the keyboard, they keep focus.
document.addEventListener("click", event => {
    const control = event.target.closest("button, input[type=checkbox], label");
    if(event.detail === 0 || !control || control.closest("dialog, .mb-menu, .mb-bar, #help, .command-row")) {
        return;
    }
    setTimeout(() => {
        const active = document.activeElement;
        if(active === document.body || active === control || control.contains(active)) {
            refocusCanvas();
        }
    }, 0);
});
let selectByPointer = false;
document.addEventListener("pointerdown", event => {
    selectByPointer = Boolean(event.target.closest("select"));
}, true);
document.addEventListener("keydown", event => {
    if(event.target.matches?.("select")) {
        selectByPointer = false;
    }
}, true);
document.addEventListener("change", event => {
    if(event.target.matches("select") && selectByPointer && !event.target.closest("dialog")) {
        setTimeout(refocusCanvas, 0);
    }
});
setHomeFocus(() => refocusCanvas());
// With nothing focused, keys go to the active layout window, as Magic's go to the window under the pointer.
document.addEventListener("keydown", event => {
    if(event.target !== document.body || event.defaultPrevented || event.key === "Escape" ||
        document.querySelector("dialog[open]")) {
        return;
    }
    const win = [driver.windows.get(activeWindow), ...driver.windows.values()].find(w => w && w.client === "layout");
    if(win) {
        driver.keyDown(win, event);
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
    if(event.key === "Escape" && !event.defaultPrevented && !$("#help").hidden) {
        event.preventDefault();
        // Opened from the keyboard: back to the Help button; otherwise to the layout.
        const fromKeyboard = document.activeElement?.closest?.("#help, #help-toggle");
        showHelp(false);
        if(fromKeyboard) {
            $("#help-toggle").focus();
        } else {
            refocusCanvas();
        }
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
    onEscape: () => {
        if(!$("#help").hidden) {
            showHelp(false);
            return true;
        }
        if(document.querySelector(".mb-menu")) {
            closeMenus();
            return true;
        }
        return false;
    },
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
    refreshRecent();
    const demo = new URLSearchParams(location.search).get("demo") || DEFAULT_DEMO;
    await loadDemo(DEMOS[demo] ? demo : DEFAULT_DEMO);
    gui.scheduleUpdate();
    refocusCanvas();
}

start().catch(fatal);

// For tests and the console.
window.magicApp = {run, runIn, runCapture, query, loadProject, gui, openStore, keepProject, syncProject,
    BrowserStore, recentProjects, get module() {
    return magic;
}, driver, get project() {
    return project;
}};
