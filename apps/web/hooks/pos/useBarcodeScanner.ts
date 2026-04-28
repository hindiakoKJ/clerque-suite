'use client';

/**
 * useBarcodeScanner — listens for HID/Bluetooth barcode-scanner input.
 *
 * How a HID scanner looks to the browser: it emulates a keyboard, typing
 * each character of the barcode at machine speed (typically <30ms between
 * keys) followed by Enter. A human typist is at least 80–100ms between keys,
 * so we use the inter-key delta to distinguish scanner input from typing.
 *
 * Detection rules:
 *   - chars arrive within <50ms of each other → scanner buffer
 *   - sequence ends with Enter → fire onScan(buffer)
 *   - >120ms gap mid-buffer → discard (was probably human typing)
 *   - min length 4 to avoid firing on stray Enter presses
 *
 * Skips when an input/textarea is focused so cashier can still type into
 * the search box without their keystrokes being misclassified as scans.
 */

import { useEffect, useRef } from 'react';

interface UseBarcodeScannerOptions {
  onScan: (barcode: string) => void;
  /** Max ms between consecutive keystrokes to count as scanner input (default 50). */
  interKeyMaxMs?: number;
  /** Min barcode length to fire (default 4). */
  minLength?: number;
  /** When false, the listener is detached. */
  enabled?: boolean;
}

const TYPABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

export function useBarcodeScanner({
  onScan,
  interKeyMaxMs = 50,
  minLength = 4,
  enabled = true,
}: UseBarcodeScannerOptions) {
  // Stable ref to onScan so we don't reattach the global listener on every render
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;

    let buffer = '';
    let lastTime = 0;

    const handler = (e: KeyboardEvent) => {
      // Don't intercept keystrokes the user is intentionally typing into a field.
      // contentEditable check covers rich-text editors.
      const target = e.target as HTMLElement | null;
      if (target) {
        if (TYPABLE_TAGS.has(target.tagName)) return;
        if (target.isContentEditable) return;
      }

      const now = performance.now();
      const delta = now - lastTime;
      lastTime = now;

      if (e.key === 'Enter') {
        if (buffer.length >= minLength) {
          const code = buffer;
          buffer = '';
          // Prevent the Enter from also submitting any nearby form
          e.preventDefault();
          onScanRef.current(code);
        } else {
          buffer = '';
        }
        return;
      }

      // Modifier keys, function keys, arrows etc. — ignore but reset buffer
      if (e.key.length !== 1) {
        buffer = '';
        return;
      }

      // Inter-key gap too large → this is human typing, not a scanner.
      // Reset and start a new candidate buffer.
      if (buffer.length > 0 && delta > interKeyMaxMs) {
        buffer = '';
      }

      buffer += e.key;
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [enabled, interKeyMaxMs, minLength]);
}
