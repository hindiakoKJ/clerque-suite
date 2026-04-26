import { useEffect } from 'react';

/**
 * Registers a `beforeunload` browser event that shows the native
 * "Leave site?" confirmation dialog whenever the cashier has an active shift.
 *
 * This fires on:
 *  - Browser tab / window close
 *  - F5 / Ctrl+R hard refresh
 *  - Navigating to a completely different origin
 *
 * Note: Modern browsers (Chrome 51+, Firefox, Safari) always show a GENERIC
 * "Changes you made may not be saved." message — the custom message is ignored
 * for security reasons. We can't change the dialog text, but we CAN trigger it.
 *
 * In-app navigation (Sign Out button) is handled separately in the layout
 * with a custom modal that gives the cashier more contextual options.
 */
export function useShiftGuard(hasActiveShift: boolean) {
  useEffect(() => {
    if (!hasActiveShift) return;

    function handler(e: BeforeUnloadEvent) {
      // Prevent the page from unloading without confirmation
      e.preventDefault();
      // Chrome / Edge require `returnValue` to be set (any non-empty value works)
      e.returnValue = '';
    }

    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasActiveShift]);
}
