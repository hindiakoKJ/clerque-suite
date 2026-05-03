'use client';

/**
 * Customer Display channel — same-device dual-monitor cart mirror.
 *
 * Strategy:
 *   1. BroadcastChannel API for same-browser-window dual-monitor setups.
 *      The cashier tablet and customer tablet are different windows in
 *      the same browser → BroadcastChannel sync is instant + free.
 *   2. localStorage fallback for browsers that lack BroadcastChannel
 *      (older Safari/iOS). Slightly slower (~16ms throttle) but works.
 *
 * For cross-device sync (cashier on Tablet A, customer on Tablet B), the
 * two tablets must share the same network — Phase 3D adds a small
 * websocket bridge for that. For now, BroadcastChannel handles the
 * common case (both screens off the same Chrome instance).
 */

const CHANNEL_NAME = 'clerque-customer-display';
const STORAGE_KEY  = 'clerque-customer-display-state';

export type CustomerDisplayMessageType =
  | 'CART_UPDATE'
  | 'PAYMENT_PENDING'
  | 'PAYMENT_COMPLETE'
  | 'CLEAR'
  | 'WELCOME';

export interface CustomerDisplayLine {
  productName: string;
  quantity:    number;
  unitPrice:   number;
  lineTotal:   number;
  modifiers?:  string[];
}

export interface CustomerDisplayState {
  type:         CustomerDisplayMessageType;
  lines:        CustomerDisplayLine[];
  subtotal:     number;
  discount:     number;
  vatAmount:    number;
  total:        number;
  /** Set during PAYMENT_COMPLETE — shows "Change due ₱XX.XX". */
  amountTendered?: number;
  changeDue?:      number;
  /** Cashier's display name, shown small at the bottom. */
  cashierName?:    string;
  branchName?:     string;
  /** Tenant business name — large branding header. */
  businessName?:   string;
  /** Sequence number — receivers ignore older messages on a race. */
  seq:          number;
  ts:           number;
}

const EMPTY_STATE: CustomerDisplayState = {
  type:     'WELCOME',
  lines:    [],
  subtotal: 0,
  discount: 0,
  vatAmount: 0,
  total:    0,
  seq:      0,
  ts:       Date.now(),
};

/** Singleton channel — created lazily on first use. */
let channel: BroadcastChannel | null = null;
function getChannel(): BroadcastChannel | null {
  if (typeof window === 'undefined') return null;
  if (typeof BroadcastChannel === 'undefined') return null;
  if (!channel) {
    try {
      channel = new BroadcastChannel(CHANNEL_NAME);
    } catch {
      return null;
    }
  }
  return channel;
}

let localSeq = 0;

/**
 * Post a state update from the cashier-side terminal.
 * Both BroadcastChannel and localStorage receive the same payload so a
 * customer display in any matching tab/window picks it up.
 */
export function publishCustomerDisplay(state: Omit<CustomerDisplayState, 'seq' | 'ts'>): void {
  if (typeof window === 'undefined') return;
  const payload: CustomerDisplayState = {
    ...state,
    seq: ++localSeq,
    ts:  Date.now(),
  };

  const ch = getChannel();
  try {
    ch?.postMessage(payload);
  } catch {
    // ignore — fall through to localStorage
  }

  // localStorage fallback (also acts as the initial state for late-joiners
  // — a customer-display tab opened mid-sale gets the current cart immediately).
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // localStorage may throw in private mode — non-fatal
  }
}

/**
 * Subscribe to customer-display updates. Receives the latest state on
 * subscription (from localStorage cache) so the screen never starts blank.
 *
 * Returns an unsubscribe function.
 */
export function subscribeCustomerDisplay(
  onUpdate: (state: CustomerDisplayState) => void,
): () => void {
  if (typeof window === 'undefined') return () => {};

  // Immediate hydration from localStorage cache
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const cached = JSON.parse(raw) as CustomerDisplayState;
      // Don't replay PAYMENT_COMPLETE on reconnect — the receipt is gone
      if (cached.type !== 'PAYMENT_COMPLETE') {
        onUpdate(cached);
      } else {
        onUpdate({ ...EMPTY_STATE, ts: Date.now() });
      }
    } else {
      onUpdate({ ...EMPTY_STATE, ts: Date.now() });
    }
  } catch {
    onUpdate({ ...EMPTY_STATE, ts: Date.now() });
  }

  // Live updates via BroadcastChannel
  let lastSeq = 0;
  const ch = getChannel();
  const onMessage = (e: MessageEvent<CustomerDisplayState>) => {
    const next = e.data;
    if (next.seq <= lastSeq) return;     // ignore stale / out-of-order
    lastSeq = next.seq;
    onUpdate(next);
  };
  ch?.addEventListener('message', onMessage);

  // Also listen to storage events so cross-window-but-same-domain
  // updates work even where BroadcastChannel is unavailable.
  const onStorage = (e: StorageEvent) => {
    if (e.key !== STORAGE_KEY || !e.newValue) return;
    try {
      const next = JSON.parse(e.newValue) as CustomerDisplayState;
      if (next.seq <= lastSeq) return;
      lastSeq = next.seq;
      onUpdate(next);
    } catch {
      // ignore parse errors
    }
  };
  window.addEventListener('storage', onStorage);

  return () => {
    ch?.removeEventListener('message', onMessage);
    window.removeEventListener('storage', onStorage);
  };
}

/** Reset the display to the welcome screen — typically called after a sale. */
export function resetCustomerDisplay(businessName?: string): void {
  publishCustomerDisplay({
    type: 'WELCOME',
    lines: [],
    subtotal: 0,
    discount: 0,
    vatAmount: 0,
    total: 0,
    businessName,
  });
}
