/*
 * grWeb.c --
 *
 *	Graphics driver for running Magic in a web browser (Emscripten).
 *
 *	Each Magic window is an HTML canvas that the page owns.  The driver
 *	follows the X11 driver's model (WIND_X_WINDOWS: one surface per
 *	Magic window, origin at the lower left of each window) and forwards
 *	every drawing call to the JavaScript object Module.magicWeb, which
 *	draws with the Canvas 2D API.  Colours and stipples are taken from
 *	the "OpenGL" display styles, as in the Cairo driver: the write mask
 *	of a style becomes the alpha of its colour.
 *
 *	Input works the other way round: the page calls the exported
 *	magic_web_* functions in magic/magicWeb.c, which queue events
 *	that TxDispatchPending() then turns into commands.
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>

#include <emscripten/emscripten.h>

#include "utils/magic.h"
#include "utils/geometry.h"
#include "utils/hash.h"
#include "utils/malloc.h"
#include "utils/styles.h"
#include "textio/textio.h"
#include "textio/txcommands.h"
#include "windows/windows.h"
#include "graphics/graphics.h"
#include "graphics/graphicsInt.h"
#include "graphics/glyphs.h"
#include "dbwind/dbwind.h"
#include "database/fonts.h"

/* ------------------------------------------------------------------------
 * JavaScript side.  Every call lands in Module.magicWeb (web/magic-canvas.js).
 * Coordinates passed to JavaScript are canvas coordinates: origin at the
 * top left, y down.
 * ------------------------------------------------------------------------
 */

EM_JS(void, webJsSelect, (int wid), { Module.magicWeb.select(wid); });
EM_JS(void, webJsCreate, (int wid, int x, int y, int w, int h, const char *title), {
    Module.magicWeb.createWindow(wid, x, y, w, h, UTF8ToString(title));
});
EM_JS(void, webJsDelete, (int wid), { Module.magicWeb.deleteWindow(wid); });
EM_JS(void, webJsConfigure, (int wid, int x, int y, int w, int h), {
    Module.magicWeb.configureWindow(wid, x, y, w, h);
});
EM_JS(void, webJsRaise, (int wid), { Module.magicWeb.raiseWindow(wid); });
EM_JS(void, webJsLower, (int wid), { Module.magicWeb.lowerWindow(wid); });
EM_JS(void, webJsTitle, (int wid, const char *title), {
    Module.magicWeb.setTitle(wid, UTF8ToString(title));
});
EM_JS(void, webJsColor, (int r, int g, int b, double a), {
    Module.magicWeb.setColor(r, g, b, a);
});
EM_JS(void, webJsDefStipple, (int i, const int *rows), {
    Module.magicWeb.defineStipple(i, HEAP32.subarray(rows >> 2, (rows >> 2) + 8));
});
EM_JS(void, webJsStipple, (int i), { Module.magicWeb.setStipple(i); });
EM_JS(void, webJsLineStyle, (int pattern), { Module.magicWeb.setLineStyle(pattern); });
EM_JS(void, webJsFillRect, (int x, int y, int w, int h), {
    Module.magicWeb.fillRect(x, y, w, h);
});
EM_JS(void, webJsLine, (int x1, int y1, int x2, int y2), {
    Module.magicWeb.drawLine(x1, y1, x2, y2);
});
EM_JS(void, webJsPolygon, (const int *pts, int n, int evenOdd), {
    Module.magicWeb.fillPolygon(HEAP32.subarray(pts >> 2, (pts >> 2) + 2 * n), evenOdd);
});
EM_JS(void, webJsClip, (int x, int y, int w, int h), {
    Module.magicWeb.pushClip(x, y, w, h);
});
EM_JS(void, webJsUnclip, (void), { Module.magicWeb.popClip(); });
EM_JS(void, webJsText, (const char *text, int size, int x, int y), {
    Module.magicWeb.drawText(UTF8ToString(text), size, x, y);
});
EM_JS(void, webJsTextSize, (const char *text, int size, int *out), {
    var m = Module.magicWeb.measureText(UTF8ToString(text), size);
    HEAP32[out >> 2] = m[0];
    HEAP32[(out >> 2) + 1] = m[1];
    HEAP32[(out >> 2) + 2] = m[2];
});
EM_JS(void, webJsBitBlt, (int sx, int sy, int w, int h, int dx, int dy), {
    Module.magicWeb.bitBlt(sx, sy, w, h, dx, dy);
});
EM_JS(void, webJsDefCursor, (int i, const unsigned char *rgba, int hx, int hy), {
    Module.magicWeb.defineCursor(i, HEAPU8.slice(rgba, rgba + 1024), hx, hy);
});
EM_JS(void, webJsSetCursor, (int i), { Module.magicWeb.setCursor(i); });
EM_JS(void, webJsScreenSize, (int *out), {
    var s = Module.magicWeb.screenSize();
    HEAP32[out >> 2] = s[0];
    HEAP32[(out >> 2) + 1] = s[1];
});
EM_JS(int, webJsCursorPos, (int wid, int *out), {
    var p = Module.magicWeb.cursorPos(wid);
    if (!p) return 0;
    HEAP32[out >> 2] = p[0];
    HEAP32[(out >> 2) + 1] = p[1];
    return 1;
});

/* ------------------------------------------------------------------------
 * Driver state
 * ------------------------------------------------------------------------
 */


static MagWindow *webCurrent = NULL;	/* Window that drawing goes to */
static int webCharSize = GR_TEXT_SMALL;

/* Magic's y axis points up, the canvas's points down. */
#define webY(y)	(webCurrent->w_allArea.r_ytop - (y))

/* Convert a screen rectangle into a canvas rectangle.  Magic's rectangles
 * include their top and right edges, so they are one pixel larger than the
 * difference of their coordinates.
 */
static void
webClipRect(r)
    Rect *r;
{
    webJsClip(r->r_xbot, webY(r->r_ytop),
	    r->r_xtop - r->r_xbot + 1, r->r_ytop - r->r_ybot + 1);
}

/* ------------------------------------------------------------------------
 * Primitives
 * ------------------------------------------------------------------------
 */

static void
grwebSetWMandC(mask, c)
    int mask;		/* Write mask, used as alpha (127 = opaque) */
    int c;		/* Colour map index */
{
    static int oldMask = -1, oldC = -1;
    int r, g, b;

    if (mask == -65) mask = 127;	/* All planes */
    if (mask == oldMask && c == oldC) return;
    oldMask = mask;
    oldC = c;
    if (!GrGetColor(c, &r, &g, &b)) r = g = b = 0;
    webJsColor(r, g, b, (mask >= 127) ? 1.0 : (double)mask / 127.0);
}

static void
grwebSetLineStyle(style)
    int style;		/* 8-bit dash pattern; 0 or 0xff is solid */
{
    webJsLineStyle(style & 0xff);
}

static void
grwebSetSPattern(sttable, numstipples)
    int **sttable;	/* 8x8 patterns, bit 0 of each row is leftmost */
    int numstipples;
{
    int i;

    for (i = 0; i < numstipples; i++)
	webJsDefStipple(i, sttable[i]);
}

static void
grwebSetStipple(stipple)
    int stipple;
{
    /* Stipple 0, or one past the table, means a solid fill. */
    webJsStipple((stipple == 0 || stipple > grNumStipples) ? 0 : stipple);
}

static void
grwebFillRect(r)
    Rect *r;
{
    webJsFillRect(r->r_xbot, webY(r->r_ytop),
	    r->r_xtop - r->r_xbot + 1, r->r_ytop - r->r_ybot + 1);
}

static void
grwebDrawLine(x1, y1, x2, y2)
    int x1, y1, x2, y2;
{
    webJsLine(x1, webY(y1), x2, webY(y2));
}

static void
grwebFillPolygon(tp, np)
    Point *tp;
    int np;
{
    int pts[2 * 8];
    int i;

    if (np > 8) np = 8;		/* Magic only fills triangles and quads */
    for (i = 0; i < np; i++)
    {
	pts[2 * i] = tp[i].p_x;
	pts[2 * i + 1] = webY(tp[i].p_y);
    }
    webJsPolygon(pts, np, FALSE);
}

static bool
grwebDrawGrid(prect, outline, clip)
    Rect *prect;	/* Grid template, in screen units times SUBPIXEL */
    int outline;	/* Line style */
    Rect *clip;		/* Clipping rectangle */
{
    int xsize, ysize, x, y, xstart, ystart, low, hi;

    xsize = prect->r_xtop - prect->r_xbot;
    ysize = prect->r_ytop - prect->r_ybot;
    if (!xsize || !ysize || GRID_TOO_SMALL(xsize, ysize))
	return FALSE;

    xstart = prect->r_xbot % xsize;
    while (xstart < clip->r_xbot << SUBPIXELBITS) xstart += xsize;
    ystart = prect->r_ybot % ysize;
    while (ystart < clip->r_ybot << SUBPIXELBITS) ystart += ysize;

    grwebSetLineStyle(outline);

    low = webY(clip->r_ybot);
    hi = webY(clip->r_ytop);
    for (x = xstart; x < (clip->r_xtop + 1) << SUBPIXELBITS; x += xsize)
	webJsLine(x >> SUBPIXELBITS, low, x >> SUBPIXELBITS, hi);

    for (y = ystart; y < (clip->r_ytop + 1) << SUBPIXELBITS; y += ysize)
	webJsLine(clip->r_xbot, webY(y >> SUBPIXELBITS),
		clip->r_xtop, webY(y >> SUBPIXELBITS));
    return TRUE;
}

/* ------------------------------------------------------------------------
 * Text
 * ------------------------------------------------------------------------
 */

static void
grwebSetCharSize(size)
    int size;
{
    webCharSize = size;
}

int
GrWebTextSize(text, size, r)
    char *text;
    int size;
    Rect *r;
{
    int m[3];		/* ascent, descent, width */

    webJsTextSize(text, size, m);
    r->r_ytop = m[0];
    r->r_ybot = -m[1];
    r->r_xtop = m[2];
    r->r_xbot = -1;
    return 0;
}

/* Remove the part of r covered by area, keeping the tallest piece
 * (same rule as the X11 driver).
 */
static void
grwebGeoSub(r, area)
    Rect *r, *area;
{
    if (r->r_xbot == area->r_xbot) r->r_xbot = area->r_xtop;
    else if (r->r_xtop == area->r_xtop) r->r_xtop = area->r_xbot;
    else if (r->r_ybot <= area->r_ybot) r->r_ybot = area->r_ytop;
    else if (r->r_ytop == area->r_ytop) r->r_ytop = area->r_ybot;
    else r->r_xtop = area->r_xbot;
}

static void
grwebPutText(text, pos, clip, obscure)
    char *text;			/* The text to be drawn */
    Point *pos;			/* Left end of the baseline */
    Rect *clip;			/* Clipping rectangle */
    LinkedRect *obscure;	/* Obscuring rectangles */
{
    Rect location, overlap, textrect;
    LinkedRect *ob;

    GrWebTextSize(text, webCharSize, &textrect);
    location.r_xbot = pos->p_x + textrect.r_xbot;
    location.r_xtop = pos->p_x + textrect.r_xtop;
    location.r_ybot = pos->p_y + textrect.r_ybot;
    location.r_ytop = pos->p_y + textrect.r_ytop;

    for (ob = obscure; ob != NULL; ob = ob->r_next)
    {
	if (GEO_TOUCH(&ob->r_r, &location))
	{
	    overlap = location;
	    GeoClip(&overlap, &ob->r_r);
	    grwebGeoSub(&location, &overlap);
	}
    }

    overlap = location;
    GeoClip(&overlap, clip);
    if ((overlap.r_xbot < overlap.r_xtop) && (overlap.r_ybot <= overlap.r_ytop))
    {
	webClipRect(&overlap);
	webJsText(text, webCharSize, pos->p_x, webY(pos->p_y));
	webJsUnclip();
    }
}

/* Vector-font text (labels with a font).  Each character's outlines are
 * filled with the even-odd rule, which matches the X11 driver's XOR fill.
 */
static void
grwebFontText(text, font, size, rotate, pos, clip, obscure)
    char *text;
    int font;
    int size;			/* Pixel size of the text */
    int rotate;			/* Rotation in degrees */
    Point *pos;			/* Text base position */
    Rect *clip;
    LinkedRect *obscure;
{
    char *tptr;
    FontChar *ccur, *clist;
    Point *coffset, *tp, lpos;
    Rect *cbbox, *frect;
    int np, i, j, baseline, ox, oy;
    int *pts;
    double fscale, scx, scy, rrad, cr, sr;

    frect = &DBFontList[font]->mf_extents;
    fscale = (double)size / (double)frect->r_ytop;
    rrad = (double)rotate * 0.0174532925;
    cr = cos(rrad);
    sr = sin(rrad);
    lpos = GeoOrigin;

    baseline = 0;
    for (tptr = text; *tptr != '\0'; tptr++)
    {
	DBFontChar(font, *tptr, NULL, NULL, &cbbox);
	if (cbbox->r_ybot < -baseline)
	    baseline = -cbbox->r_ybot;
    }
    baseline = (int)((double)baseline * fscale);

    webClipRect(clip);
    for (tptr = text; *tptr != '\0'; tptr++)
    {
	scx = (double)lpos.p_x * fscale;
	scy = (double)lpos.p_y * fscale;
	ox = pos->p_x + (int)round(scx * cr + scy * sr);
	oy = webY(pos->p_y + baseline) + (int)round(scy * cr - scx * sr);

	DBFontChar(font, *tptr, &clist, &coffset, &cbbox);
	for (ccur = clist; ccur != NULL; ccur = ccur->fc_next)
	{
	    np = ccur->fc_numpoints;
	    pts = (int *)mallocMagic(2 * np * sizeof(int));
	    tp = ccur->fc_points;
	    for (i = 0, j = 0; i < np; i++)
	    {
		scx = (double)tp[i].p_x * fscale;
		scy = (double)tp[i].p_y * fscale;
		pts[j++] = ox + (int)round(scx * cr - scy * sr);
		pts[j++] = oy - (int)round(scx * sr + scy * cr);
	    }
	    webJsPolygon(pts, np, TRUE);
	    freeMagic((char *)pts);
	}
	lpos.p_x += coffset->p_x;
	lpos.p_y += coffset->p_y;
    }
    webJsUnclip();
}

/* ------------------------------------------------------------------------
 * Glyphs and cursors
 * ------------------------------------------------------------------------
 */

void
GrWebDrawGlyph(gl, p)
    GrGlyph *gl;		/* A single glyph */
    Point *p;			/* Screen position of its lower left corner */
{
    int x, y, sx, sy, *pixelp;
    LinkedRect *ob;
    Point pt;

    GR_CHECK_LOCK();
    pixelp = gl->gr_pixels;
    for (y = 0; y < gl->gr_ysize; y++)
    {
	sy = p->p_y + y;
	for (x = 0; x < gl->gr_xsize; x++, pixelp++)
	{
	    if (*pixelp == 0) continue;
	    sx = p->p_x + x;
	    pt.p_x = sx;
	    pt.p_y = sy;
	    if (!GEO_ENCLOSE(&pt, &grCurClip)) continue;
	    for (ob = grCurObscure; ob != NULL; ob = ob->r_next)
		if (GEO_ENCLOSE(&pt, &ob->r_r)) break;
	    if (ob != NULL) continue;
	    grwebSetWMandC(127, GrStyleTable[*pixelp].color);
	    webJsStipple(0);
	    webJsFillRect(sx, webY(sy), 1, 1);
	}
    }
}

static void
grwebDefineCursor(glyphs)
    GrGlyphs *glyphs;
{
    unsigned char rgba[16 * 16 * 4];
    int n, x, y, *p, r, g, b;
    GrGlyph *gl;

    for (n = 0; n < glyphs->gr_num; n++)
    {
	gl = glyphs->gr_glyph[n];
	if ((gl->gr_xsize != 16) || (gl->gr_ysize != 16))
	{
	    TxError("Cursors must be 16 x 16 pixels.\n");
	    return;
	}
	/* Glyph rows run bottom to top; image rows run top to bottom. */
	memset(rgba, 0, sizeof rgba);
	p = gl->gr_pixels;
	for (y = 0; y < 16; y++)
	    for (x = 0; x < 16; x++, p++)
	    {
		unsigned char *q = &rgba[4 * ((15 - y) * 16 + x)];
		if (*p == STYLE_TRANSPARENT) continue;
		if (!GrGetColor(GrStyleTable[*p].color, &r, &g, &b))
		    r = g = b = 0;
		q[0] = r; q[1] = g; q[2] = b; q[3] = 255;
	    }
	webJsDefCursor(n, rgba, gl->gr_origin.p_x, 15 - gl->gr_origin.p_y);
    }
}

void
GrWebSetCursor(cursorNum)
    int cursorNum;
{
    webJsSetCursor(cursorNum);
}

/* ------------------------------------------------------------------------
 * Copying and reading the screen
 * ------------------------------------------------------------------------
 */

void
GrWebBitBlt(r, p)
    Rect *r;			/* Source area */
    Point *p;			/* Lower left corner of the destination */
{
    webJsBitBlt(r->r_xbot, webY(r->r_ytop),
	    r->r_xtop - r->r_xbot + 1, r->r_ytop - r->r_ybot + 1,
	    p->p_x, webY(p->p_y + r->r_ytop - r->r_ybot));
}

static int
GrWebReadPixel(w, x, y)
    MagWindow *w;
    int x, y;
{
    return 0;
}

static bool
grwebGetCursorPos(mw, p)
    MagWindow *mw;
    Point *p;
{
    int xy[2];

    if (mw == NULL) mw = webCurrent;
    if (mw == NULL || !webJsCursorPos(mw->w_wid, xy)) return FALSE;
    p->p_x = xy[0];
    p->p_y = mw->w_allArea.r_ytop - xy[1];
    return TRUE;
}

static bool
grwebGetCursorRootPos(mw, p)
    MagWindow *mw;
    Point *p;
{
    return grwebGetCursorPos(mw, p);
}

/* No backing store: Magic redraws exposed areas itself.  WebAssembly traps
 * when a function is called through a pointer with a different number of
 * arguments, so each stub has the arguments of the pointer it fills.
 */
static bool grwebGetBackingStore(w, area) MagWindow *w; Rect *area; { return FALSE; }
static bool grwebScrollBackingStore(w, shift) MagWindow *w; Point *shift; { return FALSE; }
static void grwebPutBackingStore(w, area) MagWindow *w; Rect *area; { }
static void grwebBackingStoreW(w) MagWindow *w; { }
static void grwebNoOp() { }

/* ------------------------------------------------------------------------
 * Windows
 * ------------------------------------------------------------------------
 */

static void
grwebFrameToPage(w, x, y, width, height)
    MagWindow *w;
    int *x, *y, *width, *height;
{
    *x = w->w_frameArea.r_xbot;
    *y = GrScreenRect.r_ytop - w->w_frameArea.r_ytop;
    *width = w->w_frameArea.r_xtop - w->w_frameArea.r_xbot;
    *height = w->w_frameArea.r_ytop - w->w_frameArea.r_ybot;
}

static bool
GrWebCreate(w, name)
    MagWindow *w;
    char *name;
{
    static bool firstWindow = TRUE;
    int x, y, width, height;

    WindSeparateRedisplay(w);

    /* The first layout window fills the desktop. */
    if (firstWindow)
    {
	Rect r;

	firstWindow = FALSE;
	r = GrScreenRect;
	r.r_xbot += 8;
	r.r_xtop -= 8;
	r.r_ytop -= 8;
	r.r_ybot += 8;
	WindReframe(w, &r, FALSE, FALSE);
    }

    w->w_grdata = (ClientData)(intptr_t)(w->w_wid + 1);
    grwebFrameToPage(w, &x, &y, &width, &height);
    webJsCreate(w->w_wid, x, y, width, height,
	    (w->w_caption != NULL) ? w->w_caption : (name ? name : "magic"));
    return TRUE;
}

static void
GrWebDelete(w)
    MagWindow *w;
{
    if (webCurrent == w) webCurrent = NULL;
    webJsDelete(w->w_wid);
}

static void
GrWebConfigure(w)
    MagWindow *w;
{
    int x, y, width, height;

    grwebFrameToPage(w, &x, &y, &width, &height);
    webJsConfigure(w->w_wid, x, y, width, height);
}

static void
GrWebRaise(w)
    MagWindow *w;
{
    webJsRaise(w->w_wid);
}

static void
GrWebLower(w)
    MagWindow *w;
{
    webJsLower(w->w_wid);
}

static void
GrWebIconUpdate(w, text)
    MagWindow *w;
    char *text;
{
    if (w->w_grdata == PTR2CD(NULL) || text == NULL) return;
    webJsTitle(w->w_wid, text);
}

static void
GrWebLock(w, inside)
    MagWindow *w;
    bool inside;
{
    grSimpleLock(w, inside);
    if (w != GR_LOCK_SCREEN)
    {
	webCurrent = w;
	webJsSelect(w->w_wid);
    }
}

static void
GrWebUnlock(w)
    MagWindow *w;
{
    grSimpleUnlock(w);
}

/* ------------------------------------------------------------------------
 * Initialisation
 * ------------------------------------------------------------------------
 */

static void
GrWebSetCMap()
{
    /* Colours are looked up with GrGetColor when they are used. */
}

static bool
GrWebInit(dispType)
    char *dispType;
{
    /* Use the OpenGL display styles: translucent layers instead of
     * bit-plane masks, which a canvas cannot do.
     */
    grCMapType = "OpenGL";
    grDStyleType = "OpenGL";
    grNumBitPlanes = 24;
    grBitPlaneMask = (1 << 24) - 1;
    return TRUE;
}

static void
GrWebClose()
{
}

static void
GrWebFlush()
{
}

/* Called by Magic's window package after a window is resized from the page. */
void
GrWebScreenSize(width, height)
    int width, height;
{
    GrScreenRect.r_xbot = GrScreenRect.r_ybot = 0;
    GrScreenRect.r_xtop = width;
    GrScreenRect.r_ytop = height;
}

bool
webSetDisplay(dispType, outFileName, mouseFileName)
    char *dispType;
    char *outFileName;
    char *mouseFileName;
{
    int size[2];

    WindPackageType = WIND_X_WINDOWS;
    WindScrollBarWidth = 14;
    /* The page's window frame shows the caption; Magic needn't draw it too. */
    WindDefaultFlags &= ~WIND_CAPTION;
    grCursorType = "color";

    GrLockPtr = GrWebLock;
    GrUnlockPtr = GrWebUnlock;
    GrInitPtr = GrWebInit;
    GrClosePtr = GrWebClose;
    GrSetCMapPtr = GrWebSetCMap;

    GrEnableTabletPtr = grwebNoOp;
    GrDisableTabletPtr = grwebNoOp;
    GrSetCursorPtr = GrWebSetCursor;
    GrTextSizePtr = GrWebTextSize;
    GrDrawGlyphPtr = GrWebDrawGlyph;
    GrReadPixelPtr = GrWebReadPixel;
    GrFlushPtr = GrWebFlush;
    GrBitBltPtr = GrWebBitBlt;

    GrCreateWindowPtr = GrWebCreate;
    GrDeleteWindowPtr = GrWebDelete;
    GrConfigureWindowPtr = GrWebConfigure;
    GrOverWindowPtr = GrWebRaise;
    GrUnderWindowPtr = GrWebLower;
    GrUpdateIconPtr = GrWebIconUpdate;
    GrGetCursorPosPtr = grwebGetCursorPos;
    GrGetCursorRootPosPtr = grwebGetCursorRootPos;

    GrGetBackingStorePtr = grwebGetBackingStore;
    GrScrollBackingStorePtr = grwebScrollBackingStore;
    GrPutBackingStorePtr = grwebPutBackingStore;
    GrFreeBackingStorePtr = grwebBackingStoreW;
    GrCreateBackingStorePtr = grwebBackingStoreW;

    grSetSPatternPtr = grwebSetSPattern;
    grPutTextPtr = grwebPutText;
    grFontTextPtr = grwebFontText;
    grDefineCursorPtr = grwebDefineCursor;
    grDrawGridPtr = grwebDrawGrid;
    grDrawLinePtr = grwebDrawLine;
    grSetWMandCPtr = grwebSetWMandC;
    grFillRectPtr = grwebFillRect;
    grSetStipplePtr = grwebSetStipple;
    grSetLineStylePtr = grwebSetLineStyle;
    grSetCharSizePtr = grwebSetCharSize;
    grFillPolygonPtr = grwebFillPolygon;

    if (!GrWebInit(dispType)) return FALSE;

    webJsScreenSize(size);
    GrWebScreenSize(size[0], size[1]);
    return TRUE;
}
