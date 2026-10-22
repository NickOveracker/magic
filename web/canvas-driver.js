// The JavaScript half of Magic's WEB graphics driver (graphics/grWeb.c).
//
// grWeb.c calls these methods through Module.magicWeb.  Each Magic window is
// a canvas inside a floating window on the desktop element.  Coordinates
// arriving here are canvas pixels with the origin at the top left; the C
// side has already flipped Magic's upward y axis.
//
// The other direction: pointer, wheel and key events on a canvas are queued
// in Magic with the exported magic_web_button / magic_web_key functions, and
// onInput() asks the app to run them.

import {FloatingWindow, HEADER_HEIGHT} from "./floating-window.js";

// X11 modifier bits and keysyms, as Magic's macros expect them.
const SHIFT = 1, LOCK = 2, CONTROL = 4, MOD1 = 8;
const KEYSYMS = {
    Backspace: 0xff08, Tab: 0xff09, Enter: 0xff0d, Escape: 0xff1b, Delete: 0xffff, Insert: 0xff63,
    Home: 0xff50, ArrowLeft: 0xff51, ArrowUp: 0xff52, ArrowRight: 0xff53, ArrowDown: 0xff54,
    PageUp: 0xff55, PageDown: 0xff56, End: 0xff57,
    F1: 0xffbe, F2: 0xffbf, F3: 0xffc0, F4: 0xffc1, F5: 0xffc2, F6: 0xffc3,
    F7: 0xffc4, F8: 0xffc5, F9: 0xffc6, F10: 0xffc7, F11: 0xffc8, F12: 0xffc9,
};
// Keypad keys by KeyboardEvent.code, with Num Lock on (digits) and off (navigation).
const KEYPAD = {
    Numpad0: [0xffb0, 0xff9e], Numpad1: [0xffb1, 0xff9c], Numpad2: [0xffb2, 0xff99], Numpad3: [0xffb3, 0xff9b],
    Numpad4: [0xffb4, 0xff96], Numpad5: [0xffb5, 0xff9d], Numpad6: [0xffb6, 0xff98], Numpad7: [0xffb7, 0xff95],
    Numpad8: [0xffb8, 0xff97], Numpad9: [0xffb9, 0xff9a], NumpadDecimal: [0xffae, 0xff9f],
    NumpadEnter: [0xff8d, 0xff8d], NumpadAdd: [0xffab, 0xffab], NumpadSubtract: [0xffad, 0xffad],
    NumpadMultiply: [0xffaa, 0xffaa], NumpadDivide: [0xffaf, 0xffaf],
};
const POINTER_BUTTON4 = 0xfeec, POINTER_BUTTON5 = 0xfeed;

const FONTS = ["10px", "14px", "18px", "24px"].map(size => size + " Helvetica, Arial, sans-serif");
// GR_TEXT_SMALL .. GR_TEXT_XLARGE are 0..3; GR_TEXT_DEFAULT (-1) is small.
const fontFor = size => FONTS[Math.max(0, Math.min(3, size))];

export class CanvasDriver {
    constructor(desktop, options = {}) {
        this.desktop = desktop;
        this.module = null;            // Set once Magic's module exists
        this.onInput = options.onInput || (() => {});
        this.onCommand = options.onCommand || (() => {});
        this.onFocusWindow = options.onFocusWindow || (() => {});
        this.onMessage = options.onMessage || (() => {});
        this.onDecorate = options.onDecorate || (() => null);
        this.onPointer = options.onPointer || (() => {});
        this.iconTarget = null;
        this.windows = new Map();      // wid -> {fw, canvas, ctx, pointer}
        this.current = null;
        this.color = "#000";
        this.stipple = 0;
        this.stipples = [];
        this.patterns = new Map();
        this.dash = [];
        this.clipDepth = 0;
        this.cursors = [];
        this.cursorIndex = -1;
        this.measure = document.createElement("canvas").getContext("2d");
        this.dpr = window.devicePixelRatio || 1;
        this.focused = -1;
    }

    // ----- Screen and windows

    screenSize() {
        return [this.desktop.clientWidth, this.desktop.clientHeight];
    }

    // Margins between a window's frame and its canvas: [left, top, right, bottom].
    chrome(win) {
        const outer = win.fw.element.getBoundingClientRect(), inner = win.host.getBoundingClientRect();
        return [inner.left - outer.left, inner.top - outer.top, outer.right - inner.right, outer.bottom - inner.bottom];
    }

    // Place a window so that its canvas covers (x, y, width, height), kept inside the desktop.
    placeWindow(win, x, y, width, height) {
        const [l, t, r, b] = this.chrome(win);
        const [dw, dh] = this.screenSize();
        let top = y - t, outerHeight = height + t + b;
        if(top < 0) {
            outerHeight += top;
            top = 0;
        }
        outerHeight = Math.min(outerHeight, dh - top);
        const left = Math.max(0, x - l), outerWidth = Math.min(width + l + r, dw - left);
        win.fw.setGeometry(left, top, outerWidth, outerHeight);
    }

    createWindow(wid, x, y, width, height, title, client) {
        const fw = new FloatingWindow(this.desktop, {
            title,
            x, y, width, height: height + HEADER_HEIGHT,
            onClose: () => {
                const layouts = [...this.windows.values()].filter(w => w.client === "layout");
                if(win.client !== "layout" || layouts.length > 1) {
                    this.onCommand(wid, "closewindow");
                } else {
                    this.onMessage("The last layout window stays open; Magic needs one to work in.");
                }
            },
            onChange: () => this.frameChanged(wid),
        });
        const canvas = document.createElement("canvas");
        canvas.className = "magic-canvas";
        canvas.tabIndex = 0;
        canvas.setAttribute("aria-label", `Magic ${client || "layout"} window`);
        const win = {wid, client, fw, canvas, host: fw.body, ctx: null, pointer: null, width: 0, height: 0};
        this.windows.set(wid, win);
        // The app may wrap the canvas in menus and toolbars; it returns the element that holds the canvas.
        win.host = this.onDecorate(win) || fw.body;
        win.host.appendChild(canvas);
        this.placeWindow(win, x, y, width, height);
        this.sizeCanvas(win);
        this.listen(win);
        if(this.cursorIndex >= 0) {
            canvas.style.cursor = this.cursors[this.cursorIndex] || "crosshair";
        }
        new ResizeObserver(() => {
            // A collapsed window's body has no size; keep the canvas (and its picture) as it was.
            if(!fw.geometry.collapsed && this.sizeCanvas(win)) {
                this.frameChanged(wid);
                // Resizing a canvas erases it, even when Magic's frame didn't change.
                this.module?._magic_web_redraw(wid);
            }
        }).observe(win.host);
        // The desktop may have clamped the window; tell Magic where it ended up.
        setTimeout(() => this.frameChanged(wid), 0);
        this.focused = wid;
    }

    // Match the canvas's backing store to its displayed size.  Returns true if it changed.
    sizeCanvas(win) {
        const width = Math.max(1, win.host.clientWidth), height = Math.max(1, win.host.clientHeight);
        const dpr = this.dpr = window.devicePixelRatio || 1;
        if(width === win.width && height === win.height && win.dpr === dpr) {
            return false;
        }
        Object.assign(win, {width, height, dpr});
        win.canvas.width = Math.round(width * dpr);
        win.canvas.height = Math.round(height * dpr);
        win.canvas.style.width = width + "px";
        win.canvas.style.height = height + "px";
        win.ctx = win.canvas.getContext("2d");
        win.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        win.ctx.imageSmoothingEnabled = false;
        if(this.current === win) {
            this.select(win.wid);
        }
        return true;
    }

    // The page moved or resized a window: give Magic its new canvas frame.
    frameChanged(wid) {
        const win = this.windows.get(wid);
        if(!win || !this.module || win.fw.geometry.collapsed) {
            return;
        }
        this.sizeCanvas(win);
        const d = this.desktop.getBoundingClientRect(), h = win.host.getBoundingClientRect();
        this.module._magic_web_configure(wid, Math.round(h.left - d.left), Math.round(h.top - d.top),
            win.width, win.height);
    }

    configureWindow(wid, x, y, width, height) {
        const win = this.windows.get(wid);
        if(win) {
            this.placeWindow(win, x, y, width, height);
            this.sizeCanvas(win);
        }
    }

    deleteWindow(wid) {
        const win = this.windows.get(wid);
        if(win) {
            win.fw.remove();
            this.windows.delete(wid);
            if(this.current === win) {
                this.current = null;
            }
        }
    }

    raiseWindow(wid) {
        this.windows.get(wid)?.fw.raise();
    }

    lowerWindow(wid) {
        this.windows.get(wid)?.fw.lower();
    }

    setTitle(wid, title) {
        this.windows.get(wid)?.fw.setTitle(title);
    }

    // ----- Drawing state

    // Negative ids below -1 are toolbar icons (see GrWebLayerIcon); they draw into iconTarget.
    select(wid) {
        this.current = (wid <= -2 ? this.iconTarget : this.windows.get(wid)) || null;
        this.ctx = this.current ? this.current.ctx : null;
    }

    setColor(r, g, b, a) {
        this.color = a >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${a.toFixed(3)})`;
    }

    defineStipple(index, rows) {
        this.stipples[index] = Array.from(rows);
        this.patterns.clear();
    }

    setStipple(index) {
        this.stipple = index;
    }

    // An 8x8 stipple in the current colour, drawn at device resolution so it stays sharp.
    fillStyle() {
        if(!this.stipple || !this.stipples[this.stipple]) {
            return this.color;
        }
        const key = this.stipple + "|" + this.color + "|" + this.dpr;
        let pattern = this.patterns.get(key);
        if(!pattern) {
            const rows = this.stipples[this.stipple], scale = Math.max(1, Math.round(this.dpr));
            const tile = document.createElement("canvas");
            tile.width = tile.height = 8 * scale;
            const t = tile.getContext("2d");
            t.fillStyle = this.color;
            for(let y = 0; y < 8; y++) {
                for(let x = 0; x < 8; x++) {
                    if(rows[y] & (1 << x)) {
                        t.fillRect(x * scale, y * scale, scale, scale);
                    }
                }
            }
            pattern = this.measure.createPattern(tile, "repeat");
            pattern.setTransform(new DOMMatrix().scale(1 / scale));
            this.patterns.set(key, pattern);
        }
        return pattern;
    }

    setLineStyle(bits) {
        this.dash = [];
        if(bits === 0 || bits === 0xff) {
            return;
        }
        // Run lengths of the 8-bit on/off pattern, starting with an "on" run.
        let start = 0;
        while(!(bits & (0x80 >> start))) {
            start++;
        }
        let run = 0, on = true;
        for(let i = 0; i < 8; i++) {
            const bit = (bits & (0x80 >> ((start + i) % 8))) !== 0;
            if(bit === on) {
                run++;
            } else {
                this.dash.push(run);
                run = 1;
                on = bit;
            }
        }
        this.dash.push(run);
        if(this.dash.length % 2) {
            this.dash.push(0);
        }
    }

    // ----- Primitives

    fillRect(x, y, width, height) {
        if(!this.ctx) {
            return;
        }
        this.ctx.fillStyle = this.fillStyle();
        this.ctx.fillRect(x, y, width, height);
    }

    drawLine(x1, y1, x2, y2) {
        const ctx = this.ctx;
        if(!ctx) {
            return;
        }
        if(x1 === x2 && y1 === y2) {
            ctx.fillStyle = this.color;
            ctx.fillRect(x1, y1, 1, 1);
            return;
        }
        ctx.strokeStyle = this.color;
        ctx.lineWidth = 1;
        ctx.lineCap = "square";
        ctx.setLineDash(this.dash);
        ctx.beginPath();
        ctx.moveTo(x1 + 0.5, y1 + 0.5);
        ctx.lineTo(x2 + 0.5, y2 + 0.5);
        ctx.stroke();
    }

    // points: flat [x0, y0, x1, y1, ...].  Even-odd fills are vector-font text, drawn solid.
    fillPolygon(points, evenOdd) {
        const ctx = this.ctx;
        if(!ctx || points.length < 6) {
            return;
        }
        ctx.beginPath();
        ctx.moveTo(points[0], points[1]);
        for(let i = 2; i < points.length; i += 2) {
            ctx.lineTo(points[i], points[i + 1]);
        }
        ctx.closePath();
        ctx.fillStyle = evenOdd ? this.color : this.fillStyle();
        ctx.fill(evenOdd ? "evenodd" : "nonzero");
    }

    pushClip(x, y, width, height) {
        if(!this.ctx) {
            return;
        }
        this.ctx.save();
        this.ctx.beginPath();
        this.ctx.rect(x, y, width, height);
        this.ctx.clip();
    }

    popClip() {
        this.ctx?.restore();
    }

    drawText(text, size, x, y) {
        const ctx = this.ctx;
        if(!ctx) {
            return;
        }
        ctx.font = fontFor(size);
        ctx.textBaseline = "alphabetic";
        ctx.fillStyle = this.color;
        ctx.fillText(text, x, y);
    }

    // [ascent, descent, width] in pixels.
    measureText(text, size) {
        this.measure.font = fontFor(size);
        const m = this.measure.measureText(text);
        const ascent = m.fontBoundingBoxAscent ?? m.actualBoundingBoxAscent;
        const descent = m.fontBoundingBoxDescent ?? m.actualBoundingBoxDescent;
        return [Math.ceil(ascent), Math.ceil(descent), Math.ceil(m.width)];
    }

    bitBlt(sx, sy, width, height, dx, dy) {
        const win = this.current;
        if(!win) {
            return;
        }
        const d = win.dpr;
        win.ctx.drawImage(win.canvas, sx * d, sy * d, width * d, height * d, dx, dy, width, height);
    }

    // ----- Cursors

    defineCursor(index, rgba, hotX, hotY) {
        const c = document.createElement("canvas");
        c.width = c.height = 16;
        c.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(rgba), 16, 16), 0, 0);
        this.cursors[index] = `url(${c.toDataURL()}) ${hotX} ${hotY}, crosshair`;
    }

    setCursor(index) {
        this.cursorIndex = index;
        for(const win of this.windows.values()) {
            win.canvas.style.cursor = this.cursors[index] || "crosshair";
        }
    }

    cursorPos(wid) {
        const win = this.windows.get(wid);
        return win && win.pointer ? [win.pointer.x, win.pointer.y] : null;
    }

    // ----- Input

    listen(win) {
        const canvas = win.canvas, wid = win.wid;
        const position = event => {
            const r = canvas.getBoundingClientRect();
            return {x: Math.round(event.clientX - r.left), y: Math.round(event.clientY - r.top)};
        };
        const down = new Map();   // pointerId -> Magic button

        canvas.addEventListener("contextmenu", event => event.preventDefault());
        canvas.addEventListener("pointerdown", event => {
            canvas.focus({preventScroll: true});
            this.focused = wid;
            this.onFocusWindow(wid);
            // Left, middle, right; Alt+left stands in for the middle button (paint) on trackpads.
            let button = [1, 2, 3][event.button];
            if(!button) {
                return;
            }
            if(button === 1 && event.altKey) {
                button = 2;
            }
            event.preventDefault();
            canvas.setPointerCapture(event.pointerId);
            down.set(event.pointerId, button);
            win.pointer = position(event);
            this.module._magic_web_button(wid, button, 0, win.pointer.x, win.pointer.y);
            this.onInput();
        });
        const up = event => {
            const button = down.get(event.pointerId);
            if(!button) {
                return;
            }
            down.delete(event.pointerId);
            win.pointer = position(event);
            this.module._magic_web_button(wid, button, 1, win.pointer.x, win.pointer.y);
            this.onInput();
        };
        canvas.addEventListener("pointerup", up);
        canvas.addEventListener("pointercancel", up);
        canvas.addEventListener("pointermove", event => {
            win.pointer = position(event);
            this.onPointer(win);
        });
        canvas.addEventListener("pointerleave", () => {
            if(!down.size) {
                win.pointer = null;
            }
        });

        // Scroll wheel: Magic binds Pointer_Button4/5 (with Shift or Control) to scroll and zoom.
        let wheel = 0;
        canvas.addEventListener("wheel", event => {
            event.preventDefault();
            win.pointer = position(event);
            wheel += event.deltaMode === 0 ? event.deltaY : event.deltaY * 40;
            const step = event.ctrlKey ? 30 : 60;
            while(Math.abs(wheel) >= step) {
                const zoom = event.ctrlKey || event.metaKey;
                // Magic binds Control+Button4 to "zoom 1.6" (out). Pinching apart arrives as
                // Ctrl+wheel up and should zoom in, so swap the buttons when zooming.
                const sym = (wheel < 0) !== zoom ? POINTER_BUTTON4 : POINTER_BUTTON5;
                const mods = (event.shiftKey ? SHIFT : 0) | (zoom ? CONTROL : 0);
                this.key(win, (mods << 16) | sym);
                wheel -= Math.sign(wheel) * step;
            }
        }, {passive: false});

        canvas.addEventListener("keydown", event => this.keyDown(win, event));
    }

    // A key for window win (its canvas has focus, or nothing else does).
    keyDown(win, event) {
        const code = this.keyCode(event);
        if(code === null || !this.module) {
            return;
        }
        event.preventDefault();
        if(code === ":".charCodeAt(0) || code === ";".charCodeAt(0)) {
            this.onCommand(win.wid, null);     // Open the command line
            return;
        }
        this.key(win, code);
    }

    key(win, code) {
        const p = win.pointer || {x: win.width >> 1, y: win.height >> 1};
        this.module._magic_web_key(win.wid, code, p.x, p.y);
        this.onInput();
    }

    // Translate a key press the way Magic's X11 helper does (graphics/grX11thread.c).
    keyCode(event) {
        if(["Shift", "Control", "Alt", "Meta", "CapsLock", "NumLock", "AltGraph"].includes(event.key)) {
            return null;
        }
        if(event.metaKey && !event.ctrlKey) {
            return null;                       // Leave Cmd shortcuts to the browser
        }
        let mods = (event.shiftKey ? SHIFT : 0) | (event.ctrlKey ? CONTROL : 0) | (event.altKey ? MOD1 : 0) |
            (event.getModifierState("CapsLock") ? LOCK : 0);

        const pad = KEYPAD[event.code];
        if(pad) {
            const numLock = event.getModifierState("NumLock");
            return ((mods & ~SHIFT) << 16) | pad[numLock && /\d/.test(event.key) ? 0 : 1];
        }

        let ch = null;
        if(event.key.length === 1) {
            ch = event.key.charCodeAt(0);
        } else if(event.key === "Enter") {
            ch = 10;
        } else if(event.key === "Backspace") {
            ch = 8;
        } else if(event.key === "Tab") {
            ch = 9;
        } else if(event.key === "Escape") {
            ch = 27;
        } else if(event.key === "Delete") {
            ch = 0x7f;
        }
        if(ch !== null && ch < 0x80) {
            // Shift alone or Control alone is part of the character; keep both only when combined.
            if(!(mods & (LOCK | MOD1))) {
                if(!(mods & CONTROL)) {
                    mods &= ~SHIFT;
                } else if(!(mods & SHIFT)) {
                    mods &= ~CONTROL;
                }
            }
            if(event.ctrlKey && /[a-z@[\\\]^_]/i.test(event.key)) {
                ch = event.key.toUpperCase().charCodeAt(0) & 0x1f;
                if(mods & CONTROL) {
                    ch += 64;                  // Control+Shift: capital letter plus modifier bits
                }
            }
            return (mods << 16) | ch;
        }
        const sym = KEYSYMS[event.key];
        return sym ? (mods << 16) | sym : null;
    }
}
