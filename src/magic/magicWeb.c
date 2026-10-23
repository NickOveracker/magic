/*
 * magicWeb.c --
 *
 *	Entry points for running Magic interactively in a web browser with
 *	the WEB graphics driver (graphics/grWeb.c).
 *
 *	The browser owns the event loop, so nothing here blocks.  The page
 *	queues mouse and keyboard events with magic_web_button() and
 *	magic_web_key(), then calls magic_web_pump() to run the commands
 *	they produce.  Background DRC runs in short slices from
 *	magic_web_drc_step(), which the page calls when it is idle.
 */

/*
 * Changes in the WebAssembly fork.
 * Added in the WebAssembly fork of Magic, https://github.com/NickOveracker/magic
 * (branch web), on 2026-10-22.  Changes, with their dates:
 *   2026-10-22  Add an interactive web build with a canvas graphics driver
 *   2026-10-22  Add the Tcl/Tk wrapper's window GUI to the web build
 *   2026-10-23  Run IRSIM from the page for Magic's simulator commands
 * End of the changes notice.
 */

/*
 * SPDX-License-Identifier: GPL-2.0-or-later
 * This file was written for the web build of Magic in the fork at
 * https://github.com/NickOveracker/magic (branch web), following the
 * structure of Magic's main program and its Tcl wrapper, which are under
 * Magic's licence (the file LICENSE).  This file is distributed under the GNU
 * General Public License, version 2 or (at your option) any later version
 * (licenses/GPL-2.0.txt), WITHOUT ANY WARRANTY.
 */

#include <stdio.h>
#include <stdlib.h>
#include <stdarg.h>
#include <string.h>

#include <emscripten/emscripten.h>

#include "utils/main.h"
#include "utils/magic.h"
#include "utils/geometry.h"
#include "utils/utils.h"
#include "tiles/tile.h"
#include "utils/hash.h"
#include "utils/malloc.h"
#include "database/database.h"
#include "textio/textio.h"
#include "textio/txcommands.h"
#include "windows/windows.h"
#include "windows/windInt.h"
#include "graphics/graphics.h"
#include "dbwind/dbwind.h"
#include "drc/drc.h"
#include "commands/commands.h"
#include "sim/sim.h"
#include "cif/CIFint.h"
#include "cif/CIFread.h"
#include "extract/extractInt.h"

#ifndef MAGIC_WRAPPER

extern void GrWebScreenSize(int width, int height);
extern bool GrWebLayerIcon();
extern int DRCWebListAll();
extern CIFReadKeep *cifReadStyleList;
extern ExtKeep *ExtAllStyles;

static bool magicWebReady = FALSE;
static double magicWebDeadline = 0.0;	/* For MagicWebShouldYield() */

/* Emscripten passes output to the page a line at a time; push out any
 * partial line (prompts, "tech layers" lists) at the end of each command.
 */
static void
magicWebFlush(void)
{
    fflush(stdout);
    fflush(stderr);
}

/* Called from the DRC loop: TRUE when the current time slice is used up. */
bool
MagicWebShouldYield(void)
{
    return (magicWebDeadline > 0.0) && (emscripten_get_now() > magicWebDeadline);
}

/* Find a window by id.  A negative id means the topmost layout window. */
static MagWindow *
magicWebWindow(int wid)
{
    MagWindow *w;

    if (wid >= 0) return WindSearchWid(wid);
    for (w = windTopWindow; w != NULL; w = w->w_nextWindow)
	if (w->w_client == DBWclientID) return w;
    return windTopWindow;
}

/*
 * Start Magic with the WEB display.  "tech" is the technology to load
 * (NULL for Magic's default).  Returns 0 on success.
 */
EMSCRIPTEN_KEEPALIVE int
magic_web_init(const char *tech)
{
    static char *argv[] = { "magic", "-d", "WEB", "-T", NULL, NULL };
    int argc = 3;

    if (magicWebReady) return 0;
    if (getenv("CAD_ROOT") == NULL) setenv("CAD_ROOT", "/", 0);
    if (tech != NULL && *tech != '\0')
    {
	argv[4] = (char *)tech;
	argc = 5;
    }
    else
	argv[3] = NULL;

    if (magicMainInit(argc, argv) != 0) return -1;
    magicWebReady = TRUE;
    TxDispatchPending();
    return 0;
}

/* Queue a mouse button event.  button: 1 left, 2 middle, 3 right.
 * (x, y) are canvas pixels from the top left of window wid.
 */
EMSCRIPTEN_KEEPALIVE void
magic_web_button(int wid, int button, int up, int x, int y)
{
    MagWindow *w = magicWebWindow(wid);
    TxInputEvent *event;

    if (!magicWebReady || w == NULL) return;
    event = TxNewEvent();
    switch (button)
    {
	case 1: event->txe_button = TX_LEFT_BUTTON; break;
	case 2: event->txe_button = TX_MIDDLE_BUTTON; break;
	case 3: event->txe_button = TX_RIGHT_BUTTON; break;
	default: event->txe_button = TX_BYPASS; break;
    }
    event->txe_buttonAction = up ? TX_BUTTON_UP : TX_BUTTON_DOWN;
    event->txe_p.p_x = x;
    event->txe_p.p_y = w->w_allArea.r_ytop - y;
    event->txe_wid = w->w_wid;
    TxAddEvent(event);
}

/* Queue a key press.  code is an ASCII character, or an X11 keysym in
 * the low 16 bits with X11 modifier bits shifted left by 16, which is
 * what extended macros (e.g. "Control_XK_Left") are keyed on.
 */
EMSCRIPTEN_KEEPALIVE void
magic_web_key(int wid, int code, int x, int y)
{
    MagWindow *w = magicWebWindow(wid);
    TxInputEvent *event;

    if (!magicWebReady || w == NULL) return;
    event = TxNewEvent();
    event->txe_button = TX_CHARACTER;
    event->txe_buttonAction = TX_KEY_DOWN;
    event->txe_ch = code;
    event->txe_p.p_x = x;
    event->txe_p.p_y = w->w_allArea.r_ytop - y;
    event->txe_wid = w->w_wid;
    TxAddEvent(event);
}

/* Run the commands produced by the queued events, then redisplay.
 * Returns the number of commands run.
 */
EMSCRIPTEN_KEEPALIVE int
magic_web_pump(void)
{
    int count;

    if (!magicWebReady) return 0;
    count = TxDispatchPending();
    magicWebFlush();
    return count;
}

/* Run a command line as if typed after ':' in window wid (negative: the
 * topmost layout window).  Returns 0 on success.
 */
EMSCRIPTEN_KEEPALIVE int
magic_web_command(int wid, const char *command)
{
    MagWindow *w = magicWebWindow(wid);
    int result;

    if (!magicWebReady || command == NULL) return -1;
    TxDispatchPending();
    if (w != NULL)
	TxSetPoint((w->w_screenArea.r_xbot + w->w_screenArea.r_xtop) / 2,
		(w->w_screenArea.r_ybot + w->w_screenArea.r_ytop) / 2, w->w_wid);
    result = TxDispatchString(command, FALSE);
    magicWebFlush();
    return result;
}

/* A line typed at the simulator prompt in "rsim" mode (sim/SimRsim.c).
 * Returns 1 while the page should stay in rsim mode.
 */
EMSCRIPTEN_KEEPALIVE int
magic_web_rsim_line(const char *line)
{
    int stay;

    if (!magicWebReady || line == NULL) return 0;
    stay = SimWebRsimLine(line) ? 1 : 0;
    WindUpdate();
    magicWebFlush();
    return stay;
}

/* Run background DRC for at most "ms" milliseconds.  Returns 1 if DRC
 * still has work left.
 */
EMSCRIPTEN_KEEPALIVE int
magic_web_drc_step(double ms)
{
    if (!magicWebReady || !DRCHasWork) return 0;
    magicWebDeadline = emscripten_get_now() + ms;
    DRCContinuous();
    magicWebDeadline = 0.0;
    WindUpdate();
    return DRCHasWork ? 1 : 0;
}

/* The page resized or moved window wid.  (x, y) is its top left corner on
 * the desktop and (width, height) its canvas size, in CSS pixels.
 */
EMSCRIPTEN_KEEPALIVE void
magic_web_configure(int wid, int x, int y, int width, int height)
{
    MagWindow *w = magicWebWindow(wid);
    Rect r;

    if (!magicWebReady || w == NULL) return;
    r.r_xbot = x;
    r.r_xtop = x + width;
    r.r_ytop = GrScreenRect.r_ytop - y;
    r.r_ybot = GrScreenRect.r_ytop - (y + height);
    if (GEO_SAMERECT(r, w->w_frameArea)) return;
    WindReframe(w, &r, FALSE, FALSE);
    WindRedisplay(w);
    WindUpdate();
}

/* The page's desktop area changed size. */
EMSCRIPTEN_KEEPALIVE void
magic_web_screen(int width, int height)
{
    GrWebScreenSize(width, height);
}

/* Repaint window wid completely (negative: all windows). */
EMSCRIPTEN_KEEPALIVE void
magic_web_redraw(int wid)
{
    MagWindow *w;

    if (!magicWebReady) return;
    if (wid < 0)
    {
	for (w = windTopWindow; w != NULL; w = w->w_nextWindow)
	    WindAreaChanged(w, &w->w_allArea);
    }
    else if ((w = WindSearchWid(wid)) != NULL)
	WindAreaChanged(w, &w->w_allArea);
    WindUpdate();
}

/* Is Magic waiting for nothing but the page?  (Used by tests.) */
EMSCRIPTEN_KEEPALIVE int
magic_web_drc_busy(void)
{
    return (magicWebReady && DRCHasWork) ? 1 : 0;
}

/* ------------------------------------------------------------------------
 * Queries for the page's menus, toolbar and managers.  Each returns text
 * in a buffer that stays valid until the next query: one record per line,
 * fields separated by tabs.
 * ------------------------------------------------------------------------
 */

static char *webText = NULL;
static int webTextLen = 0, webTextSize = 0;

static void
webReset(void)
{
    if (webText == NULL)
    {
	webTextSize = 4096;
	webText = (char *)mallocMagic(webTextSize);
    }
    webTextLen = 0;
    webText[0] = '\0';
}

static void
webAppend(const char *fmt, ...)
{
    va_list args;
    int n;

    va_start(args, fmt);
    n = vsnprintf(NULL, 0, fmt, args);
    va_end(args);
    if (webTextLen + n + 1 > webTextSize)
    {
	char *bigger;
	while (webTextLen + n + 1 > webTextSize) webTextSize *= 2;
	bigger = (char *)mallocMagic(webTextSize);
	memcpy(bigger, webText, webTextLen + 1);
	freeMagic(webText);
	webText = bigger;
    }
    va_start(args, fmt);
    vsnprintf(webText + webTextLen, n + 1, fmt, args);
    va_end(args);
    webTextLen += n;
}

/* A coordinate in the units chosen with the "units" command. */
static void
webAppendValue(int value, MagWindow *w, bool isX)
{
    webAppend("%s", DBWPrintValue(value, w, isX));
}

/*
 * The toolbar's layers: "name<TAB>locked<TAB>visible" per line, first the
 * special entries errors, labels and subcell, then every paintable layer
 * in technology order (as "tech layers *" lists them).
 */
EMSCRIPTEN_KEEPALIVE const char *
magic_web_layers(int wid)
{
    MagWindow *w = magicWebWindow(wid);
    DBWclientRec *crec = NULL;
    TileType t;

    webReset();
    if (!magicWebReady) return webText;
    if (w != NULL && w->w_client == DBWclientID)
	crec = (DBWclientRec *)w->w_clientData;

    webAppend("errors\t0\t%d\n",
	    crec ? TTMaskHasType(&crec->dbw_visibleLayers, TT_ERROR_P) : 1);
    webAppend("labels\t0\t%d\n", crec ? ((crec->dbw_flags & DBW_SEELABELS) != 0) : 1);
    webAppend("subcell\t0\t%d\n", crec ? ((crec->dbw_flags & DBW_SEECELLS) != 0) : 1);
    for (t = TT_TECHDEPBASE; t < DBNumUserLayers; t++)
    {
	if (!TTMaskHasType(&DBAllButSpaceAndDRCBits, t)) continue;
	if (DBTypeLongNameTbl[t] == NULL) continue;
	webAppend("%s\t%d\t%d\n", DBTypeLongNameTbl[t], LockedLayer(t) ? 1 : 0,
		crec ? TTMaskHasType(&crec->dbw_visibleLayers, t) : 1);
    }
    return webText;
}

/* Draw a toolbar icon; see GrWebLayerIcon in graphics/grWeb.c. */
EMSCRIPTEN_KEEPALIVE int
magic_web_layer_icon(int icon, const char *name, int size, int pale)
{
    if (!magicWebReady) return 0;
    return GrWebLayerIcon(icon, (char *)name, size, pale ? TRUE : FALSE) ? 1 : 0;
}

/*
 * The title bar of window wid:
 *	caption	<window caption>
 *	tool	<current tool>
 *	tech	<technology>
 *	box	<llx> <lly> <urx> <ury>	(only if the box is in this window)
 *	boxi	the same in internal units
 *	view	the visible area, in internal units
 *	selcell	<cell> of the selected instance, if any
 */
EMSCRIPTEN_KEEPALIVE const char *
magic_web_status(int wid)
{
    MagWindow *w = magicWebWindow(wid);
    CellDef *boxDef;
    Rect box;

    webReset();
    if (!magicWebReady || w == NULL) return webText;
    webAppend("caption\t%s\n", w->w_caption ? w->w_caption : "");
    webAppend("tool\t%s\n", DBWGetButtonHandler() ? DBWGetButtonHandler() : "");
    webAppend("tech\t%s\n", DBTechName ? DBTechName : "");
    if (ToolGetBox(&boxDef, &box) && w->w_client == DBWclientID &&
	    boxDef == ((CellUse *)w->w_surfaceID)->cu_def)
    {
	webAppend("box\t");
	webAppendValue(box.r_xbot, w, TRUE);
	webAppend(" ");
	webAppendValue(box.r_ybot, w, FALSE);
	webAppend(" ");
	webAppendValue(box.r_xtop, w, TRUE);
	webAppend(" ");
	webAppendValue(box.r_ytop, w, FALSE);
	webAppend("\nboxi\t%d %d %d %d\n", box.r_xbot, box.r_ybot, box.r_xtop, box.r_ytop);
    }
    if (w->w_client == DBWclientID)
    {
	CellUse *sel = CmdGetSelectedCell((Transform *)NULL);

	webAppend("view\t%d %d %d %d\n", w->w_surfaceArea.r_xbot, w->w_surfaceArea.r_ybot,
		w->w_surfaceArea.r_xtop, w->w_surfaceArea.r_ytop);
	if (sel != NULL) webAppend("selcell\t%s\n", sel->cu_def->cd_name);
    }
    return webText;
}

/*
 * The layout position under canvas pixel (x, y) of window wid:
 *	"<ix> <iy><TAB><x> <y>[<TAB><dx> <dy>]"
 * in internal units, then in display units, then (if the box is in this
 * window) the offset from the box's lower left corner.
 */
EMSCRIPTEN_KEEPALIVE const char *
magic_web_cursor(int wid, int x, int y)
{
    MagWindow *w = magicWebWindow(wid);
    Point screen, surface;
    CellDef *boxDef;
    Rect box;

    webReset();
    if (!magicWebReady || w == NULL || w->w_client != DBWclientID) return webText;
    screen.p_x = x;
    screen.p_y = w->w_allArea.r_ytop - y;
    WindPointToSurface(w, &screen, &surface, (Rect *)NULL);
    webAppend("%d %d\t", surface.p_x, surface.p_y);
    webAppendValue(surface.p_x, w, TRUE);
    webAppend(" ");
    webAppendValue(surface.p_y, w, FALSE);
    if (ToolGetBox(&boxDef, &box) && boxDef == ((CellUse *)w->w_surfaceID)->cu_def)
    {
	webAppend("\t");
	webAppendValue(surface.p_x - box.r_xbot, w, TRUE);
	webAppend(" ");
	webAppendValue(surface.p_y - box.r_ybot, w, FALSE);
    }
    return webText;
}

/* Cell hierarchy for the cell manager: "<depth><TAB><cell><TAB><instance>"
 * per line, depth first, starting from each top-level cell.
 */
static int webTreeUse(CellUse *use, ClientData cdata);

static void
webTreeDef(CellDef *def, int depth)
{
    if (depth > 64) return;		/* Guard against runaway recursion */
    DBCellEnum(def, webTreeUse, INT2CD(depth + 1));
}

static int
webTreeUse(CellUse *use, ClientData cdata)
{
    int depth = (int)CD2INT(cdata);

    webAppend("%d\t%s\t%s\n", depth, use->cu_def->cd_name,
	    use->cu_id ? use->cu_id : "");
    webTreeDef(use->cu_def, depth);
    return 0;
}

static int
webTreeTop(CellDef *def, ClientData cdata)
{
    CellUse *parent;

    if (def->cd_flags & CDINTERNAL) return 0;
    for (parent = def->cd_parents; parent != NULL; parent = parent->cu_nextuse)
	if (parent->cu_parent != NULL && !(parent->cu_parent->cd_flags & CDINTERNAL))
	    return 0;
    webAppend("0\t%s\t\n", def->cd_name);
    webTreeDef(def, 0);
    return 0;
}

EMSCRIPTEN_KEEPALIVE const char *
magic_web_hierarchy(void)
{
    webReset();
    if (magicWebReady) DBCellSrDefs(0, webTreeTop, (ClientData)NULL);
    return webText;
}

/*
 * Technology settings for the tech manager:
 *	name, version, description	<text>
 *	lambda	<internal units> <lambda>
 *	cifout, cifin, extract, drc	<current style><TAB><style>...
 */
EMSCRIPTEN_KEEPALIVE const char *
magic_web_tech(void)
{
    CIFKeep *ck;
    CIFReadKeep *rk;
    ExtKeep *ek;
    DRCKeep *dk;

    webReset();
    if (!magicWebReady) return webText;
    webAppend("name\t%s\n", DBTechName ? DBTechName : "");
    webAppend("version\t%s\n", DBTechVersion ? DBTechVersion : "");
    webAppend("description\t%s\n", DBTechDescription ? DBTechDescription : "");
    webAppend("lambda\t%d %d\n", DBLambda[0], DBLambda[1]);

    webAppend("cifout\t%s", CIFCurStyle ? CIFCurStyle->cs_name : "");
    for (ck = CIFStyleList; ck != NULL; ck = ck->cs_next) webAppend("\t%s", ck->cs_name);
    webAppend("\ncifin\t%s", cifCurReadStyle ? cifCurReadStyle->crs_name : "");
    for (rk = cifReadStyleList; rk != NULL; rk = rk->crs_next) webAppend("\t%s", rk->crs_name);
    webAppend("\nextract\t%s", ExtCurStyle ? ExtCurStyle->exts_name : "");
    for (ek = ExtAllStyles; ek != NULL; ek = ek->exts_next) webAppend("\t%s", ek->exts_name);
    webAppend("\ndrc\t%s", DRCCurStyle ? DRCCurStyle->ds_name : "");
    for (dk = DRCStyleList; dk != NULL; dk = dk->ds_next) webAppend("\t%s", dk->ds_name);
    webAppend("\n");
    return webText;
}

/* DRC errors in the cell shown in window wid, for the DRC manager:
 * "<rule><TAB><llx> <lly> <urx> <ury>" per line, in internal units.
 */
static void
webDrcError(char *rule, Rect *r)
{
    webAppend("%s\t%d %d %d %d\n", rule, r->r_xbot, r->r_ybot, r->r_xtop, r->r_ytop);
}

EMSCRIPTEN_KEEPALIVE const char *
magic_web_drc_list(int wid)
{
    MagWindow *w = magicWebWindow(wid);
    CellUse *use;

    webReset();
    if (!magicWebReady || w == NULL || w->w_client != DBWclientID) return webText;
    use = (CellUse *)w->w_surfaceID;
    DRCWebListAll(use, &use->cu_def->cd_bbox, webDrcError);
    WindUpdate();
    return webText;
}

#endif /* !MAGIC_WRAPPER */
