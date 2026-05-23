/**
 * Clerque Counter — order submission helper.
 *
 * Turns a cart + tendered payment(s) into a `POST /orders` request. When the
 * device is offline (or the call fails with a network error) the payload is
 * persisted to the outbox and a temporary pending number is returned so the
 * cashier can keep moving. The real OR# is filled in when the outbox drains.
 *
 * The Cloud contract is `{ order: OfflineOrder }` (see
 * packages/shared-types/src/pos.ts); we build the payload in the shape the
 * API expects. Currency is integer ₱ centavos throughout — we divide by 100
 * at the very edge because OfflineOrder uses peso decimals.
 */
import { api, ApiHttpError } from '@/api/client';
import { uuidV4 } from '@/api/uuid';
import { enqueueOutbox } from '@/offline/db';
import type {
  CartLine,
  CartPayment,
  CartState,
  PaymentMethod,
} from '@/types';

const VAT_RATE = 0.12;

/** Round to 2 decimals (peso amounts the API expects). */
function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

function isExemptKind(d: CartLine['discount']): boolean {
  return d?.kind === 'SENIOR' || d?.kind === 'PWD';
}

/** 20% for SENIOR/PWD, 50% for MARKDOWN, else stored `percent` or 0. */
function discountPercentForLine(d: CartLine['discount']): number {
  if (!d) return 0;
  if (typeof d.percent === 'number') return d.percent;
  if (d.kind === 'SENIOR' || d.kind === 'PWD') return 20;
  if (d.kind === 'MARKDOWN') return 50;
  return 0;
}

/** Map our discount kind → server enum `DiscountType`. */
function mapDiscountType(d: CartLine['discount']): 'PWD' | 'SENIOR_CITIZEN' | 'PROMO' | 'CASHIER_APPLIED' {
  if (!d) return 'CASHIER_APPLIED';
  if (d.kind === 'PWD')      return 'PWD';
  if (d.kind === 'SENIOR')   return 'SENIOR_CITIZEN';
  if (d.kind === 'MARKDOWN') return 'PROMO';
  return 'CASHIER_APPLIED';
}

/** Result returned to the UI after a Charge attempt. */
export interface SubmitOrderResult {
  /** True when the order was queued for later sync. */
  offline: boolean;
  /** Real OR# when online; `pending-…` placeholder when queued offline. */
  orderNumber: string;
  /** Server order id (only present when the call succeeded online). */
  orderId?: string;
  /** Echoed for the receipt screen. */
  clientUuid: string;
}

export interface SubmitOrderArgs {
  cart: CartState;
  payments: CartPayment[];
  branchId: string;
  shiftId?: string;
  /** Forwarded as the body's tenant tax classification. Default VAT_12. */
  isVatRegistered?: boolean;
}

/**
 * Map our local PaymentMethod to the Cloud's PaymentMethod enum. The Cloud
 * splits GCash / Maya into personal vs business wallets — at the till we
 * just submit the personal variant; back-office can re-tag later.
 */
function mapMethod(m: PaymentMethod): string {
  switch (m) {
    case 'CASH':    return 'CASH';
    case 'GCASH':   return 'GCASH_PERSONAL';
    case 'PAYMAYA': return 'MAYA_PERSONAL';
    case 'CARD':    return 'CARD';   // Visa/MC/JCB through EDC terminal
    case 'QR_PH':   return 'QR_PH';  // BSP national InstaPay QR
    case 'OTHER':
    default:        return 'QR_PH';  // Conservative fallback — never card
  }
}

function activeLines(cart: CartState): CartLine[] {
  return cart.lines.filter((l) => !l.removed && !l.voidedAt);
}

/**
 * Compute per-line tax + discount in ₱ centavos. BIR rules implemented:
 *
 *   - SENIOR / PWD: 20% off, AND the line becomes VAT-exempt for VAT-
 *     registered tenants (RA 9994 / RA 10754). Math:
 *       grossInclVat   = lineTotal (we store VAT-inclusive)
 *       netOfVat       = grossInclVat / 1.12        ← strip out the VAT
 *       discount       = netOfVat × 20%             ← 20% on the net
 *       lineFinal      = netOfVat − discount        ← customer pays this
 *       vatAmount      = 0                          ← exempt
 *
 *   - MARKDOWN (bakery EOD) and any % discount: VAT still applies on the
 *     *discounted* amount. Math (VAT-inclusive prices):
 *       grossInclVat   = lineTotal
 *       discount       = grossInclVat × pct
 *       discountedGross= grossInclVat − discount
 *       vatAmount      = discountedGross − discountedGross/1.12
 *       lineFinal      = discountedGross
 *
 *   - No discount on a VAT-registered line: VAT-inclusive, 12% extracted.
 *   - Non-VAT tenant: vatAmount = 0 across the board.
 */
function linePricing(l: CartLine, isVatRegistered: boolean) {
  const grossCents = l.lineTotal;
  const pct        = discountPercentForLine(l.discount);
  const exempt     = isVatRegistered && isExemptKind(l.discount);

  if (exempt) {
    const netOfVat       = Math.round(grossCents / (1 + VAT_RATE));
    const discountCents  = Math.round(netOfVat * (pct / 100));
    const lineFinalCents = Math.max(0, netOfVat - discountCents);
    return {
      grossCents,
      discountCents,
      vatAmountCents: 0,
      lineFinalCents,
      isVatable: false,
      taxType: 'VAT_EXEMPT' as const,
    };
  }

  const discountCents     = pct > 0 ? Math.round(grossCents * (pct / 100)) : 0;
  const discountedCents   = Math.max(0, grossCents - discountCents);
  const vatAmountCents    = isVatRegistered
    ? Math.round(discountedCents - discountedCents / (1 + VAT_RATE))
    : 0;
  return {
    grossCents,
    discountCents,
    vatAmountCents,
    lineFinalCents: discountedCents,
    isVatable:      isVatRegistered,
    taxType:        isVatRegistered ? ('VAT_12' as const) : ('VAT_EXEMPT' as const),
  };
}

function buildItems(cart: CartState, isVatRegistered: boolean) {
  return activeLines(cart).map((l) => {
    const p = linePricing(l, isVatRegistered);
    return {
      productId:   l.productId,
      variantId:   l.variantId,
      productName: l.productName,
      unitPrice:   l.unitPrice / 100,
      quantity:    l.qty,
      discountAmount: r2(p.discountCents / 100),
      vatAmount:      r2(p.vatAmountCents / 100),
      lineTotal:      r2(p.lineFinalCents / 100),
      isVatable:      p.isVatable,
      taxType:        p.taxType,
      modifiers: l.modifiers.map((m) => ({
        modifierGroupId:  m.groupId,
        modifierOptionId: m.optionId,
        groupName:        m.groupName,
        optionName:       m.optionName,
        priceAdjustment:  m.priceAdjustment / 100,
      })),
    };
  });
}

/** Order-level totals — sum the per-line pricing in cents, divide at the edge. */
function totals(cart: CartState, isVatRegistered: boolean) {
  const lines = activeLines(cart).map((l) => linePricing(l, isVatRegistered));
  const subtotalCents = lines.reduce((s, p) => s + p.grossCents, 0);
  const discountCents = lines.reduce((s, p) => s + p.discountCents, 0);
  const vatAmountCents = lines.reduce((s, p) => s + p.vatAmountCents, 0);
  const totalCents = lines.reduce((s, p) => s + p.lineFinalCents, 0);
  return {
    subtotal:       r2(subtotalCents / 100),
    discountAmount: r2(discountCents / 100),
    vatAmount:      r2(vatAmountCents / 100),
    totalAmount:    r2(totalCents / 100),
  };
}

/**
 * Build the order-level `discounts: []` array. The server stores this on
 * `OrderDiscount` rows used by the BIR Sales Detail Report and audit logs.
 * One row per discount kind applied — we aggregate per kind so multiple
 * lines with the same SENIOR discount collapse into one row.
 */
function buildDiscounts(cart: CartState, isVatRegistered: boolean) {
  const lines = activeLines(cart);
  const byKind = new Map<string, { kind: NonNullable<CartLine['discount']>['kind']; pct: number; amountCents: number }>();
  for (const l of lines) {
    if (!l.discount) continue;
    const pct = discountPercentForLine(l.discount);
    if (pct <= 0) continue;
    const p = linePricing(l, isVatRegistered);
    if (p.discountCents <= 0) continue;
    const key = `${l.discount.kind}:${pct}`;
    const prev = byKind.get(key);
    if (prev) {
      prev.amountCents += p.discountCents;
    } else {
      byKind.set(key, { kind: l.discount.kind, pct, amountCents: p.discountCents });
    }
  }
  return Array.from(byKind.values()).map((d) => ({
    discountType:    mapDiscountType({ kind: d.kind } as CartLine['discount']),
    discountPercent: d.pct,
    discountAmount:  r2(d.amountCents / 100),
    reason:          d.kind === 'SENIOR'   ? 'Senior Citizen 20% (RA 9994)'
                   : d.kind === 'PWD'      ? 'PWD 20% (RA 10754)'
                   : d.kind === 'MARKDOWN' ? 'End-of-day markdown'
                   : 'Cashier-applied',
    pwdScIdRef:       cart.pwdScId?.idRef,
    pwdScIdOwnerName: cart.pwdScId?.ownerName,
  }));
}

export function buildOrderPayload(
  args: SubmitOrderArgs,
  clientUuid: string,
): { order: Record<string, unknown> } {
  const { cart, payments, branchId, shiftId, isVatRegistered = true } = args;
  const t = totals(cart, isVatRegistered);
  const isPwdSc = !!cart.pwdScId;
  return {
    order: {
      clientUuid,
      branchId,
      shiftId,
      items: buildItems(cart, isVatRegistered),
      payments: payments.map((p) => ({
        method: mapMethod(p.method),
        amount: p.amount / 100,
        reference: p.reference,
      })),
      discounts: buildDiscounts(cart, isVatRegistered),
      ...t,
      isPwdScDiscount: isPwdSc,
      pwdScIdRef: cart.pwdScId?.idRef,
      pwdScIdOwnerName: cart.pwdScId?.ownerName,
      createdAt: new Date().toISOString(),
      invoiceType: 'CASH_SALE',
      taxType: isVatRegistered ? 'VAT_12' : 'VAT_EXEMPT',
      customerName: cart.customer?.name,
      customerTin: cart.customer?.tin,
      customerId: cart.customer?.id,
    },
  };
}

function isNetworkError(err: unknown): boolean {
  return err instanceof ApiHttpError && err.status === 0;
}

/**
 * Try `POST /orders` with an Idempotency-Key. On network failure → outbox.
 * On 4xx / 5xx (anything that did receive an HTTP response) → throw so the
 * UI surfaces the validation error rather than silently queueing bad data.
 */
export async function submitOrder(args: SubmitOrderArgs): Promise<SubmitOrderResult> {
  const clientUuid = uuidV4();
  const payload = buildOrderPayload(args, clientUuid);

  try {
    const res = await api.post<{ id: string; orderNumber: string }>(
      '/orders',
      payload,
      { headers: { 'Idempotency-Key': clientUuid } },
    );
    return {
      offline: false,
      orderNumber: res.orderNumber,
      orderId: res.id,
      clientUuid,
    };
  } catch (err) {
    if (isNetworkError(err)) {
      await enqueueOutbox('order.create', payload);
      return {
        offline: true,
        orderNumber: `pending-${clientUuid.slice(0, 8)}`,
        clientUuid,
      };
    }
    throw err;
  }
}
