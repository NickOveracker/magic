/*
 * macros.c --
 *
 * Defines and retrieves macros
 *
 *     *********************************************************************
 *     * Copyright (C) 1985, 1990 Regents of the University of California. *
 *     * Permission to use, copy, modify, and distribute this              *
 *     * software and its documentation for any purpose and without        *
 *     * fee is hereby granted, provided that the above copyright          *
 *     * notice appear in all copies.  The University of California        *
 *     * makes no representations about the suitability of this            *
 *     * software for any purpose.  It is provided "as is" without         *
 *     * express or implied warranty.  Export of this software outside     *
 *     * of the United States of America may require an export license.    *
 *     *********************************************************************
 */

#ifndef lint
static char rcsid[] __attribute__ ((unused)) = "$Header: /usr/cvsroot/magic-8.0/utils/macros.c,v 1.2 2010/06/24 12:37:58 tim Exp $";
#endif  /* not lint */

#include <stdio.h>
#include <string.h>
#include <strings.h>
#include <signal.h>
#include <ctype.h>
#ifdef XLIB
#include <X11/X.h>
#include <X11/Xlib.h>
#include <X11/keysym.h>
#define MACRO_KEYSYMS		/* Extended (keysym) macro names */
#define KEYSYMS_ACTIVE()	(grXdpy != NULL)
#elif defined(MAGIC_WEB)
/* The web build has no Xlib, but its key events use X11 keysyms and
 * modifier bits, so extended macros work the same way.  This table covers
 * the keysym names that the default macros and the browser can produce.
 */
#define MACRO_KEYSYMS
#define KEYSYMS_ACTIVE()	(TRUE)
#define ShiftMask	(1<<0)
#define LockMask	(1<<1)
#define ControlMask	(1<<2)
#define Mod1Mask	(1<<3)
#define NoSymbol	0
typedef int KeySym;

static const struct { const char *name; int sym; } webKeysyms[] = {
    {"space", 0x20}, {"exclam", 0x21}, {"quotedbl", 0x22},
    {"numbersign", 0x23}, {"dollar", 0x24}, {"percent", 0x25},
    {"ampersand", 0x26}, {"apostrophe", 0x27}, {"parenleft", 0x28},
    {"parenright", 0x29}, {"asterisk", 0x2a}, {"plus", 0x2b},
    {"comma", 0x2c}, {"minus", 0x2d}, {"period", 0x2e}, {"slash", 0x2f},
    {"colon", 0x3a}, {"semicolon", 0x3b}, {"less", 0x3c}, {"equal", 0x3d},
    {"greater", 0x3e}, {"question", 0x3f}, {"at", 0x40},
    {"bracketleft", 0x5b}, {"backslash", 0x5c}, {"bracketright", 0x5d},
    {"asciicircum", 0x5e}, {"underscore", 0x5f}, {"grave", 0x60},
    {"braceleft", 0x7b}, {"bar", 0x7c}, {"braceright", 0x7d},
    {"asciitilde", 0x7e},
    {"BackSpace", 0xff08}, {"Tab", 0xff09}, {"Return", 0xff0d},
    {"Escape", 0xff1b}, {"Delete", 0xffff}, {"Insert", 0xff63},
    {"Home", 0xff50}, {"Left", 0xff51}, {"Up", 0xff52}, {"Right", 0xff53},
    {"Down", 0xff54}, {"Prior", 0xff55}, {"Page_Up", 0xff55},
    {"Next", 0xff56}, {"Page_Down", 0xff56}, {"End", 0xff57},
    {"KP_Enter", 0xff8d}, {"KP_Home", 0xff95}, {"KP_Left", 0xff96},
    {"KP_Up", 0xff97}, {"KP_Right", 0xff98}, {"KP_Down", 0xff99},
    {"KP_Prior", 0xff9a}, {"KP_Page_Up", 0xff9a}, {"KP_Next", 0xff9b},
    {"KP_Page_Down", 0xff9b}, {"KP_End", 0xff9c}, {"KP_Begin", 0xff9d},
    {"KP_Insert", 0xff9e}, {"KP_Delete", 0xff9f}, {"KP_Multiply", 0xffaa},
    {"KP_Add", 0xffab}, {"KP_Subtract", 0xffad}, {"KP_Decimal", 0xffae},
    {"KP_Divide", 0xffaf}, {"KP_0", 0xffb0}, {"KP_1", 0xffb1},
    {"KP_2", 0xffb2}, {"KP_3", 0xffb3}, {"KP_4", 0xffb4}, {"KP_5", 0xffb5},
    {"KP_6", 0xffb6}, {"KP_7", 0xffb7}, {"KP_8", 0xffb8}, {"KP_9", 0xffb9},
    {"F1", 0xffbe}, {"F2", 0xffbf}, {"F3", 0xffc0}, {"F4", 0xffc1},
    {"F5", 0xffc2}, {"F6", 0xffc3}, {"F7", 0xffc4}, {"F8", 0xffc5},
    {"F9", 0xffc6}, {"F10", 0xffc7}, {"F11", 0xffc8}, {"F12", 0xffc9},
    {"Pointer_Button1", 0xfee9}, {"Pointer_Button2", 0xfeea},
    {"Pointer_Button3", 0xfeeb}, {"Pointer_Button4", 0xfeec},
    {"Pointer_Button5", 0xfeed},
    {NULL, 0}
};

static KeySym
XStringToKeysym(const char *name)
{
    int i;
    for (i = 0; webKeysyms[i].name != NULL; i++)
	if (!strcmp(webKeysyms[i].name, name)) return webKeysyms[i].sym;
    return NoSymbol;
}

static char *
XKeysymToString(KeySym ks)
{
    static char ascii[2];
    int i;
    for (i = 0; webKeysyms[i].name != NULL; i++)
	if (webKeysyms[i].sym == ks) return (char *)webKeysyms[i].name;
    if (ks > 0x20 && ks < 0x7f)
    {
	ascii[0] = (char)ks;
	ascii[1] = '\0';
	return ascii;
    }
    return NULL;
}
#endif

#include "utils/magic.h"
#include "utils/main.h"
#include "utils/utils.h"
#include "utils/hash.h"
#include "utils/malloc.h"
#include "utils/macros.h"
#include "windows/windows.h"
#include "dbwind/dbwind.h"

/* C99 compat */
#include "textio/textio.h"

/* Define the macro client table */

HashTable MacroClients;

/*
 *---------------------------------------------------------
 * MacroInit ---
 *
 *	Initialize the macro hash table
 *
 * Results:
 *	None.
 *
 * Side Effects:
 *	Memory allocated for the hash table MacroClients.
 *
 * Note:
 *	Hash type changed from WORDKEYS to STRINGKEYS.
 *	This is slightly less efficient but allows the
 *	layout window client to be divided into separate
 *	macro clients for each tool type, accessed by
 *	name.
 *
 *---------------------------------------------------------
 */

void
MacroInit()
{
    HashInit(&MacroClients, 4, HT_STRINGKEYS);
}

/*
 *---------------------------------------------------------
 * MacroDefineByName ---
 *
 *	This procedure defines a macro.  The macro table is
 *	defined by name, not by client.  MacroDefine() is a
 *	wrapper for this routine.
 *
 * Results:
 *	None.
 *
 * Side Effects:
 *	The string passed is copied and considered to be the
 *	macro definition for the character.
 *---------------------------------------------------------
 */

void
MacroDefineByName(clientName, xc, str, help, imacro)
    char *clientName;	/* window client name */
    int xc;		/* full (X11) keycode of macro with modifiers */
    char *str;		/* ...and the string to be attached to it */
    char *help;		/* ...and/or the help text for the macro */
    bool imacro;	/* is this an interactive macro? */
{
    HashEntry *h;
    HashTable *clienttable, newTable;
    macrodef *oldMacro, *newMacro;

    /* If a macro exists, delete the old string and redefine it */
    h = HashFind(&MacroClients, (char *)clientName);
    clienttable = (HashTable *)HashGetValue(h);
    if (clienttable == NULL)
    {
	clienttable = (HashTable *)mallocMagic(sizeof(HashTable));
	HashInit(clienttable, 32, HT_WORDKEYS);
	HashSetValue(h, clienttable);
    }
    h = HashFind(clienttable, (char *)INT2CD(xc));
    oldMacro = (macrodef *)HashGetValue(h);
    if (oldMacro != NULL)
    {
	if (oldMacro->macrotext != NULL)
	    freeMagic(oldMacro->macrotext);
	if (oldMacro->helptext != NULL) {
	    freeMagic(oldMacro->helptext);
	    oldMacro->helptext = NULL;
	}
	newMacro = oldMacro;
    }
    else
	newMacro = (macrodef *)mallocMagic(sizeof(macrodef));

    HashSetValue(h, newMacro);
    newMacro->interactive = imacro;
    newMacro->macrotext = StrDup((char **)NULL, str);
    if (help != NULL)
	newMacro->helptext = StrDup((char **)NULL, help);
    else
	newMacro->helptext = NULL;
}

/*
 *------------------------------------------------------------------
 * MacroDefine ---
 *
 *	This procedure is a simple wrapper for MacroDefineByName().
 *	The window client is given as a client ID.  This limits
 *	macros to one set per client type.  To allow a more
 *	flexible macro handling, if the client is a layout window
 *	(DBWclientID), then the name is instead taken from the
 *	name of the tool currently active.  This allows macros
 *	to be uniquely defined for each tool.
 *
 * Results:
 *	None.
 *
 * Side Effects:
 *	The string passed is copied and considered to be the
 *	macro definition for the character.
 *------------------------------------------------------------------
 */

void
MacroDefine(client, xc, str, help, imacro)
    WindClient client;	/* window client type */
    int xc;		/* full (X11) keycode of macro with modifiers */
    char *str;		/* ...and the string to be attached to it */
    char *help;		/* ...and/or the help text for the macro */
    bool imacro;	/* is this an interactive macro? */
{
    char *clientName = NULL;

    if (client == DBWclientID)
	clientName = DBWGetButtonHandler();
    if (clientName == NULL)
	clientName = WindGetClientName(client);

    MacroDefineByName(clientName, xc, str, help, imacro);
}

/*
 *---------------------------------------------------------
 * MacroDefineHelp ---
 *
 *	This procedure defines the help text for a macro.
 *	A macro must already exist for the specified key.
 *
 * Results:
 *	None.
 *
 * Side Effects:
 *	The string passed is copied and considered to be the
 *	macro definition for the character.
 *---------------------------------------------------------
 */

void
MacroDefineHelp(client, xc, help)
    WindClient client;	/* window client type */
    int xc;		/* full (X11) keycode of macro with modifiers */
    char *help;		/* ...and/or the help text for the macro */
{
    HashEntry *h;
    HashTable *clienttable;
    macrodef *curMacro;
    char *clientName = NULL;

    if (client == DBWclientID)
	clientName = DBWGetButtonHandler();
    if (clientName == NULL)
	clientName = WindGetClientName(client);

    /* If a macro exists, delete the old string and redefine it */
    h = HashFind(&MacroClients, (char *)clientName);
    clienttable = (HashTable *)HashGetValue(h);
    if (clienttable == NULL) return;

    h = HashFind(clienttable, (char *)INT2CD(xc));
    curMacro = (macrodef *)HashGetValue(h);
    if (curMacro == NULL) return;

    if (curMacro->helptext != NULL)
	freeMagic(curMacro->helptext);

    if (help == NULL)
	curMacro->helptext = NULL;
    else
	curMacro->helptext = StrDup((char **)NULL, help);
}

/*---------------------------------------------------------
 * MacroRetrieve:
 *	This procedure retrieves a macro.
 *
 * Results:
 *	A pointer to a new Malloc'ed string is returned.
 *	This structure should be freed when the caller is
 *	done with it.
 *
 * Side Effects:
 *	None.
 *---------------------------------------------------------
 */

/* Look up a macro in the table of the client (or tool) named clientName. */
static macrodef *
macroLookup(clientName, xc)
    char *clientName;
    int xc;
{
    HashEntry *h;
    HashTable *clienttable;

    if (clientName == NULL) return NULL;
    h = HashLookOnly(&MacroClients, (char *)clientName);
    if (h == NULL) return NULL;
    clienttable = (HashTable *)HashGetValue(h);
    if (clienttable == NULL) return NULL;
    h = HashLookOnly(clienttable, (char *)INT2CD(xc));
    return (h == NULL) ? NULL : (macrodef *)HashGetValue(h);
}

char *
MacroRetrieve(client, xc, iReturn)
    WindClient client;		/* window client type */
    int xc;			/* the extended name of the macro */
    bool *iReturn;		/* TRUE if macro is interactive */
{
    macrodef *cMacro = NULL;
    char *clientName = NULL;

    if (client == DBWclientID)
	clientName = DBWGetButtonHandler();
    if (clientName == NULL)
	clientName = WindGetClientName(client);
    if (clientName == NULL)
	return NULL;

    cMacro = macroLookup(clientName, xc);

#ifndef MAGIC_WRAPPER
    /* Each tool ("box", "wiring", ...) has its own macro table, and the
     * startup macros go into the box tool's.  The Tcl version copies them
     * into the other tools' tables; without Tcl those start empty, so fall
     * back to the box tool's macros for keys a tool doesn't bind itself.
     */
    if (cMacro == NULL && client == DBWclientID)
	cMacro = macroLookup(DBWGetDefaultButtonHandler(), xc);
#endif

    if (cMacro != NULL)
    {
	if (iReturn != NULL)
	    *iReturn = cMacro->interactive;
	return StrDup((char **)NULL, cMacro->macrotext);
    }
    if (iReturn != NULL) *iReturn = FALSE;
    return (char *)NULL;
}

/*---------------------------------------------------------
 * MacroRetrieveHelp:
 *	This procedure retrieves the help text for a macro.
 *
 * Results:
 *	A pointer to a new Malloc'ed string is returned.
 *	This structure should be freed when the caller is
 *	done with it.
 *
 * Side Effects:
 *	None.
 *---------------------------------------------------------
 */

char *
MacroRetrieveHelp(client, xc)
    WindClient client;		/* window client type */
    int xc;			/* the extended name of the macro */
{
    HashEntry *h;
    HashTable *clienttable;
    macrodef *cMacro;
    char *clientName = NULL;

    if (client == DBWclientID)
	clientName = DBWGetButtonHandler();
    if (clientName == NULL)
	clientName = WindGetClientName(client);

    /* If a macro exists, delete the old string and redefine it */
    h = HashLookOnly(&MacroClients, (char *)clientName);
    if (h != NULL)
    {
	clienttable = (HashTable *)HashGetValue(h);
	if (clienttable != NULL)
	{
	    h = HashLookOnly(clienttable, (char *)INT2CD(xc));
	    if (h != NULL)
	    {
		cMacro = (macrodef *)HashGetValue(h);
		if (cMacro != NULL)
		    if (cMacro->helptext != NULL)
			return StrDup((char **)NULL, cMacro->helptext);
	    }
	}
    }
    return (char *)NULL;
}

/*---------------------------------------------------------
 * MacroSubsitute:
 *	Make a substitution of one string for another
 *	in a macro string.  This is really just a string
 *	manipulation;  it doesn't have anything specifically
 *	to do with macros.
 *
 * Results:
 *	A new string pointer to the macro contents.
 *
 * Side Effects:
 *	None.
 *---------------------------------------------------------
 */

char *
MacroSubstitute(macrostr, searchstr, replacestr)
    char *macrostr;
    char *searchstr;
    char *replacestr;
{
    char *found, *last, *new;
    int expand, length, oldlength, srchsize;

    if (macrostr == (char *)NULL) return NULL;

    oldlength = strlen(macrostr);
    srchsize = strlen(searchstr);
    expand = strlen(replacestr) - srchsize;
    last = macrostr;
    length = oldlength;
    while ((found = strstr(last, searchstr)) != NULL)
    {
	length += expand;
	last = found + srchsize;
    }
    if (length > oldlength)
    {
	new = (char *)mallocMagic(length + 1);
	*new = '\0';
	last = macrostr;
	while ((found = strstr(last, searchstr)) != NULL)
	{
	   *found = '\0';
	   strcat(new, last);
	   strcat(new, replacestr);
	   last = found + srchsize;
	}
	strcat(new, last);
	freeMagic(macrostr);
	return new;
    }
    else
	return macrostr;
}


/*---------------------------------------------------------
 * MacroDelete:
 *	This procedure deletes a macro.
 *
 * Results:	None.
 *
 * Side Effects:
 *	The string that defines a macro is deleted.  This means
 *	that if anybody still has a pointer to that string
 *	they are in trouble.
 *---------------------------------------------------------
 */

void
MacroDelete(client, xc)
    WindClient client;	/* window client type */
    int xc;		/* the extended name of the macro */
{
    HashEntry *h;
    HashTable *clienttable;
    macrodef *cMacro;
    char *clientName = NULL;

    if (client == DBWclientID)
	clientName = DBWGetButtonHandler();
    if (clientName == NULL)
	clientName = WindGetClientName(client);

    h = HashLookOnly(&MacroClients, (char *)clientName);
    if (h != NULL)
    {
	clienttable = (HashTable *)HashGetValue(h);
	if (clienttable != NULL)
	{
	    h = HashLookOnly(clienttable, (char *)INT2CD(xc));
	    if (h != NULL)
	    {
		cMacro = (macrodef *)HashGetValue(h);
		if (cMacro != NULL)
		{
		    if (cMacro->macrotext != NULL)
			freeMagic(cMacro->macrotext);
		    if (cMacro->helptext != NULL)
			freeMagic(cMacro->helptext);
		    HashSetValue(h, NULL);
		    freeMagic(cMacro);
		}
	    }
	}
    }
}

/*
 * ----------------------------------------------------------------------------
 * MacroCopy --
 *	Copy all macros from one table to another.
 *	This is used with the "tool" command to simplify the process
 *	of defining new macro sets for button and keypress actions
 *	for a new tool type.  It copies all of the macros from the
 *	table for the client passed as (WindClient type) "client" to
 *	the table for the client named by (string) "clientkey".
 *
 * Results:
 *	None.
 *
 * Side effects:
 *	New hash entries are created.
 * ----------------------------------------------------------------------------
 */

void
MacroCopy(client, clientkey)
    WindClient client;	/* Current window client */
    char *clientkey;	/* Name of client to copy macros to */
{
    HashTable *clienttable;
    HashTable *copytable;
    HashEntry *h, *he;
    HashSearch hs;
    char *clientName;
    int cKey;
    macrodef *cMacro;

    if (clientkey == NULL) return;
    if (client == (WindClient)NULL) return;

    if (client == DBWclientID)
        clientName = DBWGetButtonHandler();
    if (clientName == NULL)
        clientName = WindGetClientName(client);

    h = HashLookOnly(&MacroClients, (char *)clientName);
    if (h == NULL) return;	/* No clients, nothing can be done */

    clienttable = (HashTable *)HashGetValue(h);
    if (clienttable == NULL) return;	/* Also nothing can be done */

    HashStartSearch(&hs);
    while (TRUE)
    {
	he = HashNext(clienttable, &hs);
	if (he == NULL) break;
	cMacro = (macrodef *)HashGetValue(he);
	cKey = (int)CD2INT(he->h_key.h_ptr);
	MacroDefineByName(clientkey, cKey, cMacro->macrotext,
			cMacro->helptext, cMacro->interactive);
    }
}

/*
 * ----------------------------------------------------------------------------
 * MacroName --
 * 	Convert an extended keycode to a string.
 *
 * Results:
 *	The string.
 *
 * Side effects:
 *	The string is malloc'ed from memory, and must be free'd later.
 * ----------------------------------------------------------------------------
 */

char *
MacroName(xc)
    int xc;
{
    char *vis;
    static char hex[17] = "0123456789ABCDEF";

#ifdef MACRO_KEYSYMS
    char *str;
#ifdef XLIB
    extern Display *grXdpy;
#endif
    KeySym ks = xc & 0xffff;
    int kmod = xc >> 16;

    str = NULL;
    if (KEYSYMS_ACTIVE()) {
        ks = xc & 0xffff;
	if (ks != NoSymbol) str = XKeysymToString(ks);
    }
    if (str != NULL)
    {
	vis = (char *) mallocMagic( sizeof(char) * (strlen(str) + 32) );
	vis[0] = '\0';
	if (kmod & Mod1Mask) strcat(vis, "Meta_");
	if (kmod & ControlMask) strcat(vis, "Control_");
	if (kmod & LockMask) strcat(vis, "Capslock_");
	if (kmod & ShiftMask) strcat(vis, "Shift_");
	strcat(vis, "XK_");
	strcat(vis, str);
	return (vis);
    }
#endif

    vis = (char *) mallocMagic( sizeof(char) * 6 );
    if (xc < (int)' ')
    {
	vis[0] = '^';
	vis[1] = (char)xc + '@';
	vis[2] = '\0';
    }
    else if (xc == 0x7F)
    {
	vis[0] = '<';
	vis[1] = 'd';
	vis[2] = 'e';
	vis[3] = 'l';
	vis[4] = '>';
	vis[5] = '\0';
    }
    else if (xc < 0x80)
    {
	vis[0] = (char)xc;
	vis[1] = '\0';
    }
    else
    {
	vis = (char *) mallocMagic( sizeof(char) * 8 );
	vis[0] = '0';
	vis[1] = 'x';
#ifdef MACRO_KEYSYMS
	vis[2] = hex[ (kmod & 0xf)];
#else
	vis[2] = '0';
#endif
	vis[3] = hex[ (xc & 0x0f000) >> 12];
	vis[4] = hex[ (xc & 0x00f00) >>  8];
	vis[5] = hex[ (xc & 0x000f0) >>  4];
	vis[6] = hex[ (xc & 0x0000f)      ];
	vis[7] = '\0';
    }
    return(vis);
}


/*
 * ----------------------------------------------------------------------------
 * MacroKey:
 * 	Convert a string to an extended keycode.
 *
 * Results:
 *	An extended macro name.
 *
 * Side effects:
 *	If the display being used is not X11, a warning is printed the
 *	first time this function is called.
 * ----------------------------------------------------------------------------
 */

int
MacroKey(str, verbose)
    char *str;
    int *verbose;
{
    static int warn = 1;

#ifdef MACRO_KEYSYMS
    int kc;
    char *vis;
#ifdef XLIB
    extern Display *grXdpy;
#endif
    KeySym ks;
    int kmod = 0;

    *verbose = 1;
    if (KEYSYMS_ACTIVE())
    {
	vis = str;
	while( (*vis) != '\0' )
	{
	    if (!strncmp(vis, "Meta_", 5))
	    {
		kmod |= Mod1Mask;
		vis += 5;
	    }
	    else if (!strncmp(vis, "Alt_", 4))
	    {
		kmod |= Mod1Mask;
		vis += 4;
	    }
	    else if (!strncmp(vis, "Control_", 8))
	    {
		kmod |= ControlMask;
		vis += 8;
	    }
	    else if (((*vis) == '^') && (*(vis + 1) != '\0'))
	    {
		kmod |= ControlMask;
		vis++;
	    }
	    else if (!strncmp(vis, "Capslock_", 9))
	    {
		kmod |= LockMask;
		vis += 9;
	    }
	    else if (!strncmp(vis, "Shift_", 6))
	    {
		kmod |= ShiftMask;
		vis += 6;
	    }
	    else if (*vis == '\'')
	    {
		// If single quotes are used to protect the integrity
		// of the macro character, strip them now.

		char *aptr = strrchr(vis, '\'');
		if (aptr != NULL && aptr != vis)
		{
		   vis++;
		   *aptr = '\0';
		}
		else break;	// Don't hang on an unmatched quote
	    }
	    else break;
	}
	if (!strncmp(vis, "XK_", 3)) vis += 3;

	/* We're converting all ASCII back into X Keycodes 	*/
	/* The original macro (.magicrc) file format allows	*/
	/* embedded control characters, so we have to handle	*/
	/* those.  For regular ASCII characters, the keysym =	*/
	/* the ASCII value.					*/

	if ((*(vis + 1)) == '\0')
	{
	    /* single ASCII character handling */

	    char tc = *vis;

	    /* Revert Control and Shift characters to ASCII	*/
	    /* unless other modifiers are present. Always make	*/
	    /* characters with Control and Shift uppercase.	*/

	    if (kmod & (ControlMask | ShiftMask))
	    {
		tc = toupper(tc);
		if (kmod & ShiftMask)
		    kc = (int)tc;
		else if (kmod & ControlMask)
		    kc = (int)(tc - 'A' + 1);
		else
		    kc = (int)tc;

		if (!(kmod & (Mod1Mask | LockMask)))
		    if (!(kmod & ShiftMask) || !(kmod & ControlMask))
		       kmod = 0;
	    }
	    else
		kc = (int)tc;
	}
	else if (!strncmp(vis, "<del>", 5))
	    /* Because, weirdly, there is no keysymdef for the "Delete" key */
	    kc = (int)0x7f;
	else
	{
	    /* X11 keysym name handling */

	    /* If macro "Button" is used, then prepend	*/
	    /* "Pointer" to match the keysymdef.	*/
	    /* (Added by NP 10/20/04)			*/

	    char *pointerStr = NULL;
	    if (!strncmp(vis, "Button", 6))
	    {
		pointerStr = (char *)mallocMagic(9 + strlen(str));
		strcpy(pointerStr, "Pointer_");
		strcat(pointerStr, vis);
		vis = pointerStr;
	    }
	    ks = XStringToKeysym(vis);
	    kc = (ks != NoSymbol) ? ks & 0xffff : 0;
	    if (pointerStr != NULL) freeMagic(pointerStr);
	}
	return (kc | (kmod << 16));
    }
#endif

    *verbose = 1;
    if (strlen(str) == 1)
    {
	return (int)str[0];
    }
    else if (strlen(str) == 2 && *str == '^')
    {
	return (int)str[1] - 'A' + 1;
    }
    if (warn)
    {
	if (strcasecmp(MainDisplayType, "NULL") || (TxTkConsole == TRUE))
	    TxPrintf("Extended macros are unavailable"
			" with graphics type \"%s\".\n", MainDisplayType);
    }
    warn = 0;
    *verbose = 0;
    return(0);
}


/*
 * ----------------------------------------------------------------------------
 * CommandLineTranslate
 * 	Convert X11 definitions to readline controls
 *
 * Results:
 *	A converted character (integer)
 *
 * Side effects:
 *	None.
 * ----------------------------------------------------------------------------
 */

int
TranslateChar(key)
    int key;
{
    int rval = key;

#ifdef XLIB
    switch (key)
    {
	case XK_Left:
	    rval = (int)'\002';	/* Ctrl-B */
	    break;
	case XK_Right:
	    rval = (int)'\006';	/* Ctrl-F */
	    break;
	case XK_Up:
	    rval = (int)'\020';	/* Ctrl-P */
	    break;
	case XK_Down:
	    rval = (int)'\016';	/* Ctrl-N */
	    break;
	case XK_BackSpace:
	case XK_Delete:
	    rval = (int)'\010';	/* Ctrl-H */
	    break;
	case XK_Home:
	    rval = (int)'\001';	/* Ctrl-A */
	    break;
	case XK_End:
	    rval = (int)'\005';	/* Ctrl-E */
	    break;
    }
#endif
    return rval;
}
