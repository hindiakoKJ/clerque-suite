/**
 * Every POS dialog has to fit the smallest screens the shop really uses:
 * the 1024x600 Android tablet and a 375-wide phone. The shared Dialog
 * primitive centres a panel with no height limit, so a tall form (Senior/PWD,
 * Close Shift) pushed its own Apply / Close buttons below the screen where no
 * amount of scrolling could reach them.
 *
 * Two shapes, picked per dialog:
 *
 *   FRAME + BODY + FOOTER  the panel is a column no taller than the screen;
 *                          the title and the action buttons stay put and only
 *                          the middle scrolls. Use when the dialog has a
 *                          primary action the cashier must always be able to
 *                          reach.
 *
 *   SCROLL                 the whole panel scrolls inside the screen. Use for
 *                          short dialogs that only overflow on the tablet.
 *
 * 1.5rem leaves a 12px gutter all round so the panel never touches the edge
 * of a phone. `dvh` tracks the space left once the on-screen keyboard or the
 * browser bar is showing.
 */
export const DIALOG_FIT_FRAME =
  'flex max-h-[calc(100dvh-1.5rem)] w-[calc(100vw-1.5rem)] flex-col overflow-hidden';

export const DIALOG_FIT_BODY = 'min-h-0 flex-1 overflow-y-auto overscroll-contain';

export const DIALOG_FIT_FOOTER = 'shrink-0 border-t border-border';

export const DIALOG_FIT_SCROLL =
  'max-h-[calc(100dvh-1.5rem)] w-[calc(100vw-1.5rem)] overflow-y-auto overscroll-contain';
