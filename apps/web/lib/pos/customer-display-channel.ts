'use client';

import { api } from '@/lib/api';

/**
 * Customer Display channel — multi-topology cart mirror.
 *
 * Layered strategy (each layer adds coverage, never replaces a previous one):
 *
 *   1. BroadcastChannel API   — same browser, different windows. Instant,
 *                               zero network. Best UX when both screens are
 *                               off the same Chrome instance.
 *   2. localStorage fallback  — same origin, no BroadcastChannel support
 *                               (older Safari). Storage event fires across
 *                               tabs in the same browser profile.
 *   3. Server-mediated relay  — DIFFERENT browser profiles or DIFFERENT
 *                               devices. POST snapshot to the API; customer
 *                               screen polls every 1s. Phase 3E.
 *
 * The cashier-side `publishCustomerDisplay()` writes to all 3 layers in
 * parallel. The customer-side `subscribeCustomerDisplay()` reads from all
 * 3, dedupes by sequence, and renders the freshest. Net effect: it Just
 * Works in every topology — single browser, two profiles, two tablets.
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
  /** Sprint 7: order number to show on the PREPARING screen so the customer
   *  can match their slip when they're called. */
  orderNumber?:    string;
  /** Sprint 7: true when the order is in production (PAID, not yet COMPLETED).
   *  Drives the secondary "We're preparing your order" message after the
   *  initial Salamat / change-due display. */
  isPreparing?:    boolean;
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
 * Writes to all 3 channels in parallel:
 *   1. BroadcastChannel (same browser)
 *   2. localStorage (cross-window same browser)
 *   3. Server relay POST /customer-display/state (cross-device, cross-profile)
 *
 * The third path is fire-and-forget — failure (offline, slow API) is
 * silently swallowed because the local channels usually carry the message
 * and the customer screen will catch up on its next 1s poll anyway.
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

  // Server relay — covers cross-device + cross-profile cases.
  // Don't await; UI shouldn't block on this.
  api.post('/customer-display/state', {
    type:           payload.type,
    lines:          payload.lines,
    subtotal:       payload.subtotal,
    discount:       payload.discount,
    vatAmount:      payload.vatAmount,
    total:          payload.total,
    amountTendered: payload.amountTendered,
    changeDue:      payload.changeDue,
    cashierName:    payload.cashierName,
    branchName:     payload.branchName,
    businessName:   payload.businessName,
  }).catch(() => { /* swallow — local channels usually carry the message */ });
}

/**
 * Subscribe to customer-display updates. Receives the latest state on
 * subscription (from localStorage cache) so the screen never starts blank.
 *
 * @param onUpdate Called with each new state.
 * @param opts.cashierId  When set, polls the server relay for THIS cashier's
 *                         feed (used when cashier and customer are on different
 *                         devices/profiles). When null, the customer screen
 *                         only receives same-browser updates via BroadcastChannel
 *                         + localStorage.
 *
 * Returns an unsubscribe function.
 */
export function subscribeCustomerDisplay(
  onUpdate: (state: CustomerDisplayState) => void,
  opts: { cashierId?: string | null; pollIntervalMs?: number } = {},
): () => void {
  if (typeof window === 'undefined') return () => {};

  // Immediate hydration from localStorage cache (same-browser case)
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

  // Live updates via BroadcastChannel (same browser instant path)
  let lastSeq = 0;
  let lastServerSeq = 0;
  const ch = getChannel();
  const onMessage = (e: MessageEvent<CustomerDisplayState>) => {
    const next = e.data;
    if (next.seq <= lastSeq) return;
    lastSeq = next.seq;
    onUpdate(next);
  };
  ch?.addEventListener('message', onMessage);

  // localStorage event — fallback for browsers without BroadcastChannel.
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

  // Server-mediated polling — cross-device / cross-profile path.
  // When cashierId is provided, poll GET /customer-display/state every 1s.
  // The server returns the latest snapshot keyed by tenantId+cashierId.
  const pollIntervalMs = opts.pollIntervalMs ?? 1000;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  if (opts.cashierId) {
    const cashierId = opts.cashierId;
    const tick = async () => {
      try {
        const { data } = await api.get<{
          exists: boolean;
          seq?: number;
          type?: CustomerDisplayState['type'];
          lines?: CustomerDisplayState['lines'];
          subtotal?: number;
          discount?: number;
          vatAmount?: number;
          total?: number;
          amountTendered?: number;
          changeDue?: number;
          cashierName?: string;
          branchName?: string;
          businessName?: string;
        }>(`/customer-display/state?cashierId=${encodeURIComponent(cashierId)}`);
        if (!data.exists) return;
        const seq = data.seq ?? 0;
        if (seq <= lastServerSeq) return;
        lastServerSeq = seq;
        const state: CustomerDisplayState = {
          type:        data.type ?? 'WELCOME',
          lines:       data.lines ?? [],
          subtotal:    data.subtotal ?? 0,
          discount:    data.discount ?? 0,
          vatAmount:   data.vatAmount ?? 0,
          total:       data.total ?? 0,
          amountTendered: data.amountTendered,
          changeDue:      data.changeDue,
          cashierName:    data.cashierName,
          branchName:     data.branchName,
          businessName:   data.businessName,
          seq:            seq,
          ts:             Date.now(),
        };
        // Bump local seq so BroadcastChannel updates from this point on
        // continue to win when both paths deliver the same payload.
        if (state.seq > lastSeq) lastSeq = state.seq;
        onUpdate(state);
      } catch {
        // Network blip — ignore, next tick will retry.
      }
    };
    void tick();                               // immediate first tick
    pollTimer = setInterval(tick, pollIntervalMs);
  }

  return () => {
    ch?.removeEventListener('message', onMessage);
    window.removeEventListener('storage', onStorage);
    if (pollTimer) clearInterval(pollTimer);
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
