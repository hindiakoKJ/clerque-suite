'use client';

import { api } from '@/lib/api';
import { readDeviceToken } from '@/lib/pos/device-token';

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
  /** When type === 'PAYMENT_PENDING', tells the customer display which
   *  payment method the cashier picked so the screen can show the right
   *  brand color + QR-code prompt ("Scan with GCash"). */
  paymentMethod?: 'CASH' | 'GCASH' | 'PAYMAYA' | 'CARD' | 'SPLIT';
  /** Optional pre-uploaded QR image for the tenant's GCash/PayMaya account.
   *  Falls back to a generic placeholder when not set. */
  qrImageUrl?:    string;
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

/**
 * Sequence counter. Receivers drop anything whose seq is not greater than the
 * last one they accepted, so this MUST keep climbing across page loads.
 *
 * It used to start at 0 in every tab. Reload the cashier terminal mid-shift
 * and it republished from seq 1 while the customer screen was still holding
 * lastSeq at, say, 47 — so every subsequent update was silently discarded and
 * the display froze until someone refreshed it. Seeding from the persisted
 * state closes that hole.
 */
let localSeq = 0;
let seqSeeded = false;

function nextSeq(): number {
  if (!seqSeeded) {
    seqSeeded = true;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const cached = JSON.parse(raw) as Partial<CustomerDisplayState>;
        if (typeof cached.seq === 'number' && Number.isFinite(cached.seq)) {
          localSeq = Math.max(localSeq, cached.seq);
        }
      }
    } catch {
      // Unreadable cache — start from zero and let the ts guard cover us.
    }
  }
  return ++localSeq;
}

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
    seq: nextSeq(),
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
 * @param opts.pollServer When true, polls the server relay. WITHOUT a
 *                         cashierId the relay returns the tenant's freshest
 *                         snapshot, whoever published it — the universal
 *                         behaviour a shop's wall display wants. The screen
 *                         must never care which ACCOUNT is signed in on it;
 *                         keying the poll to the viewer's account meant a
 *                         display signed in as the owner watched the owner's
 *                         empty feed while the cashier rang sales into hers.
 * @param opts.cashierId  Optional narrowing to one till's feed, for shops
 *                         running one display per till.
 *
 * Returns an unsubscribe function.
 */
export function subscribeCustomerDisplay(
  onUpdate: (state: CustomerDisplayState) => void,
  opts: { cashierId?: string | null; pollServer?: boolean; pollIntervalMs?: number } = {},
): () => void {
  if (typeof window === 'undefined') return () => {};

  // Carries the hydrated snapshot forward so the live guards below start from
  // what was already rendered rather than from zero.
  let hydrated: CustomerDisplayState | null = null;

  // Immediate hydration from localStorage cache (same-browser case)
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const cached = JSON.parse(raw) as CustomerDisplayState;
      // Don't replay PAYMENT_COMPLETE on reconnect — the receipt is gone
      if (cached.type !== 'PAYMENT_COMPLETE') {
        hydrated = cached;
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
  let lastTs = 0;
  let lastServerSeq = 0;
  let lastStoredAt = 0;

  /**
   * Accept a message if its sequence advanced, OR if it is plainly newer by
   * wall clock. The second clause is the self-heal: should a publisher ever
   * restart its counter (a reload, a cleared cache, a second cashier tab),
   * a stale lastSeq would otherwise discard every future update and freeze
   * this screen until a human refreshed it. Both publisher and subscriber run
   * on the same machine in the same-browser topology, so ts is comparable.
   */
  const isFresher = (next: CustomerDisplayState): boolean =>
    next.seq > lastSeq || next.ts > lastTs;

  if (hydrated) {
    lastSeq = hydrated.seq ?? 0;
    lastTs  = hydrated.ts ?? 0;
  }

  const accept = (next: CustomerDisplayState) => {
    lastSeq = Math.max(lastSeq, next.seq);
    lastTs  = Math.max(lastTs, next.ts);
    onUpdate(next);
  };

  const ch = getChannel();
  const onMessage = (e: MessageEvent<CustomerDisplayState>) => {
    const next = e.data;
    if (!isFresher(next)) return;
    accept(next);
  };
  ch?.addEventListener('message', onMessage);

  // localStorage event — fallback for browsers without BroadcastChannel.
  const onStorage = (e: StorageEvent) => {
    if (e.key !== STORAGE_KEY || !e.newValue) return;
    try {
      const next = JSON.parse(e.newValue) as CustomerDisplayState;
      if (!isFresher(next)) return;
      accept(next);
    } catch {
      // ignore parse errors
    }
  };
  window.addEventListener('storage', onStorage);

  // Server-mediated polling — cross-device / cross-profile path.
  // When cashierId is provided, poll GET /customer-display/state every 1s.
  // The server returns the latest snapshot keyed by tenantId+cashierId.
  // Default sized for a customer-facing screen: a shopper watching their order
  // appear notices a full second. 300ms reads as immediate.
  const pollIntervalMs = opts.pollIntervalMs ?? 300;
  // Self-scheduling rather than setInterval: at 300ms a slow response would
  // otherwise let ticks overlap and pile up in-flight requests on a weak shop
  // connection. Chaining from completion keeps at most one request open.
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  if (opts.pollServer || opts.cashierId) {
    const cashierId = opts.cashierId ?? null;
    const tick = async () => {
      try {
        // A paired display has no JWT — its device token IS its identity.
        // The poll always failed silently in paired mode before this header
        // existed; only same-browser BroadcastChannel made it look alive.
        const device = readDeviceToken();
        const { data } = await api.get<{
          exists: boolean;
          seq?: number;
          storedAt?: number;
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
        }>(
          cashierId
            ? `/customer-display/state?cashierId=${encodeURIComponent(cashierId)}`
            : '/customer-display/state',
          device?.deviceToken ? { headers: { 'X-Device-Token': device.deviceToken } } : undefined,
        );
        if (!data.exists) return;
        const seq = data.seq ?? 0;
        // storedAt is the primary freshness signal: the relay's seq counter
        // resets when the API restarts, its clock does not.
        const at = data.storedAt ?? 0;
        if (at <= lastStoredAt && seq <= lastServerSeq) return;
        lastServerSeq = Math.max(lastServerSeq, seq);
        lastStoredAt = Math.max(lastStoredAt, at);
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
        accept(state);
      } catch {
        // Network blip — ignore, next tick will retry.
      }
    };

    const loop = async () => {
      if (stopped) return;
      await tick();
      if (stopped) return;
      pollTimer = setTimeout(loop, pollIntervalMs);
    };
    void loop();                               // immediate first tick
  }

  return () => {
    ch?.removeEventListener('message', onMessage);
    window.removeEventListener('storage', onStorage);
    stopped = true;
    if (pollTimer) clearTimeout(pollTimer);
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
