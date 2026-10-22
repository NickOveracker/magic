// Floating windows on a desktop element: drag by the title bar, resize from
// the right edge, bottom edge or corner, collapse to the title bar, close.
// Clicking a window brings it to the front.  With the title bar focused,
// arrow keys move the window and Shift+arrow keys resize it.
//
// Geometry is in pixels relative to the desktop.  onChange(geometry) runs
// after every move or resize, so the owner can follow along.

const STYLES = `
.fw-window { position: absolute; display: flex; flex-direction: column; box-sizing: border-box;
  background: var(--panel); color: var(--fg); border: 1px solid var(--rule);
  border-radius: 8px; box-shadow: 0 6px 22px rgba(0,0,0,.22); overflow: hidden; }
.fw-header { display: flex; align-items: center; gap: 4px; height: 30px; box-sizing: border-box;
  padding: 0 4px 0 10px; cursor: move; user-select: none; touch-action: none;
  background: var(--head); border-bottom: 1px solid var(--rule); font-size: 13px; font-weight: 600; }
.fw-header:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.fw-title { flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.fw-button { border: 0; background: none; color: inherit; font: inherit; width: 26px; height: 24px;
  border-radius: 5px; cursor: pointer; }
.fw-button:hover, .fw-button:focus-visible { background: var(--rule); }
.fw-body { position: relative; flex: 1; min-height: 0; overflow: hidden; }
.fw-window.fw-collapsed .fw-body, .fw-window.fw-collapsed .fw-resize { display: none; }
.fw-window.fw-collapsed .fw-header { border-bottom: 0; }
.fw-resize { position: absolute; touch-action: none; z-index: 1; }
.fw-e { top: 0; right: 0; width: 7px; height: 100%; cursor: ew-resize; }
.fw-s { left: 0; bottom: 0; height: 7px; width: 100%; cursor: ns-resize; }
.fw-se { right: 0; bottom: 0; width: 14px; height: 14px; cursor: nwse-resize; }
`;

export const HEADER_HEIGHT = 30;

let topZ = 10;

export class FloatingWindow {
    constructor(desktop, options) {
        if(!document.getElementById("fw-styles")) {
            const style = document.createElement("style");
            style.id = "fw-styles";
            style.textContent = STYLES;
            document.head.appendChild(style);
        }
        this.desktop = desktop;
        this.onClose = options.onClose || null;
        this.onChange = options.onChange || null;
        this.onCollapse = options.onCollapse || null;
        this.min = {width: 160, height: 100};

        const el = this.element = document.createElement("section");
        el.className = "fw-window";
        el.innerHTML = '<header class="fw-header" tabindex="0"><span class="fw-title"></span>' +
            '<button type="button" class="fw-button fw-collapse"></button>' +
            '<button type="button" class="fw-button fw-close" aria-label="Close" title="Close">✕</button></header>' +
            '<div class="fw-body"></div>' +
            '<div class="fw-resize fw-e" data-edge="e"></div><div class="fw-resize fw-s" data-edge="s"></div>' +
            '<div class="fw-resize fw-se" data-edge="se"></div>';
        this.header = el.querySelector(".fw-header");
        this.body = el.querySelector(".fw-body");
        this.setTitle(options.title || "");
        desktop.appendChild(el);

        this.geometry = {x: options.x, y: options.y, width: options.width, height: options.height,
            collapsed: false};
        this.apply();
        this.listen();
        this.raise();
    }

    setTitle(title) {
        this.element.querySelector(".fw-title").textContent = title;
        this.element.setAttribute("aria-label", title);
    }

    raise() {
        this.element.style.zIndex = ++topZ;
    }

    lower() {
        let lowest = Infinity;
        for(const other of this.desktop.querySelectorAll(".fw-window")) {
            lowest = Math.min(lowest, Number(other.style.zIndex) || 0);
        }
        this.element.style.zIndex = lowest - 1;
    }

    remove() {
        this.element.remove();
    }

    setCollapsed(collapsed) {
        this.geometry.collapsed = collapsed;
        this.apply();
        if(this.onCollapse) {
            this.onCollapse(collapsed);
        }
    }

    // Keep part of the title bar inside the desktop, and the window no smaller than its minimum.
    clamp() {
        const g = this.geometry, dw = this.desktop.clientWidth, dh = this.desktop.clientHeight;
        g.width = Math.max(this.min.width, Math.round(g.width));
        g.height = Math.max(this.min.height, Math.round(g.height));
        g.x = Math.round(Math.min(Math.max(g.x, 60 - g.width), dw - 60));
        g.y = Math.round(Math.min(Math.max(g.y, 0), Math.max(0, dh - HEADER_HEIGHT)));
    }

    // Set the geometry without telling the owner (used when the owner moved the window).
    setGeometry(x, y, width, height) {
        Object.assign(this.geometry, {x, y, width, height});
        this.apply();
    }

    apply() {
        this.clamp();
        const g = this.geometry, el = this.element;
        el.style.left = g.x + "px";
        el.style.top = g.y + "px";
        el.style.width = g.width + "px";
        el.style.height = g.collapsed ? "auto" : g.height + "px";
        el.classList.toggle("fw-collapsed", g.collapsed);
        const button = el.querySelector(".fw-collapse");
        button.textContent = g.collapsed ? "▸" : "▾";
        button.setAttribute("aria-label", g.collapsed ? "Expand" : "Collapse");
        button.title = button.getAttribute("aria-label");
        button.setAttribute("aria-expanded", String(!g.collapsed));
    }

    changed() {
        if(this.onChange) {
            this.onChange(this.geometry);
        }
    }

    listen() {
        const el = this.element;
        el.addEventListener("pointerdown", () => this.raise(), true);
        el.querySelector(".fw-close").onclick = () => this.onClose ? this.onClose() : this.remove();
        el.querySelector(".fw-collapse").onclick = () => this.setCollapsed(!this.geometry.collapsed);
        this.header.addEventListener("dblclick", event => {
            if(!event.target.closest(".fw-button")) {
                this.setCollapsed(!this.geometry.collapsed);
            }
        });

        this.drag(this.header, (start, dx, dy) => {
            this.geometry.x = start.x + dx;
            this.geometry.y = start.y + dy;
        }, event => !event.target.closest(".fw-button"));
        for(const handle of el.querySelectorAll(".fw-resize")) {
            const edge = handle.dataset.edge;
            this.drag(handle, (start, dx, dy) => {
                if(edge.includes("e")) {
                    this.geometry.width = start.width + dx;
                }
                if(edge.includes("s")) {
                    this.geometry.height = start.height + dy;
                }
            });
        }

        this.header.addEventListener("keydown", event => {
            const steps = {ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1]};
            const step = steps[event.key];
            if(!step || event.target !== this.header) {
                return;
            }
            event.preventDefault();
            const g = this.geometry, amount = event.altKey ? 1 : 16;
            if(event.shiftKey) {
                g.width += step[0] * amount;
                g.height += step[1] * amount;
            } else {
                g.x += step[0] * amount;
                g.y += step[1] * amount;
            }
            this.apply();
            this.changed();
        });
    }

    // Pointer dragging on a handle: update(startGeometry, dx, dy) on each move.
    // The owner hears about the change when the drag ends.
    drag(handle, update, accept) {
        let start = null;
        handle.addEventListener("pointerdown", event => {
            if(event.button !== 0 || (accept && !accept(event))) {
                return;
            }
            event.preventDefault();
            start = {px: event.clientX, py: event.clientY, ...this.geometry};
            handle.setPointerCapture(event.pointerId);
        });
        handle.addEventListener("pointermove", event => {
            if(start) {
                update(start, event.clientX - start.px, event.clientY - start.py);
                this.apply();
            }
        });
        const stop = () => {
            if(start) {
                start = null;
                this.changed();
            }
        };
        handle.addEventListener("pointerup", stop);
        handle.addEventListener("pointercancel", stop);
    }
}
