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

#include <stdio.h>
#include <stdlib.h>

#include <emscripten/emscripten.h>

#include "utils/main.h"
#include "utils/magic.h"
#include "utils/geometry.h"
#include "textio/textio.h"
#include "textio/txcommands.h"
#include "windows/windows.h"
#include "windows/windInt.h"
#include "graphics/graphics.h"
#include "dbwind/dbwind.h"
#include "drc/drc.h"

#ifndef MAGIC_WRAPPER

extern void GrWebScreenSize(int width, int height);

static bool magicWebReady = FALSE;
static double magicWebDeadline = 0.0;	/* For MagicWebShouldYield() */

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
    if (!magicWebReady) return 0;
    return TxDispatchPending();
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
    return result;
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

#endif /* !MAGIC_WRAPPER */
