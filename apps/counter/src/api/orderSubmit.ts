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
    case 'CASH': return 'CASH';
    case 'GCASH': return 'GCASH_PERSONAL';
    case 'PAYMAYA': return 'MAYA_PERSONAL';
    case 'CARD':
    case 'OTHER':
    default:
      // The Cloud enum has no CARD member yet; fall back to QR_PH so the
      // payload validates. Receipt UI still displays the user-facing label.
      return 'QR_PH';
  }
}

function activeLines(cart: CartState): CartLine[] {
  return cart.lines.filter((l) => !l.removed && !l.voidedAt);
}

function buildItems(cart: CartState, isVatRegistered: boolean) {
  return activeLines(cart).map((l) => {
    const lineTotalPeso = l.lineTotal / 100;
    const isVatable = isVatRegistered; // tenant-level for now; per-line tagging is a Phase-2 item
    const vatAmount = isVatable ? Math.round(l.lineTotal - l.lineTotal / (1 + VAT_RATE)) / 100 : 0;
    return {
      productId: l.productId,
      variantId: l.variantId,
      productName: l.productName,
      unitPrice: l.unitPrice / 100,
      quantity: l.qty,
      discountAmount: 0,
      vatAmount,
      lineTotal: lineTotalPeso,
      isVatable,
      taxType: isVatable ? 'VAT_12' : 'VAT_EXEMPT',
      modifiers: l.modifiers.map((m) => ({
        modifierGroupId: m.groupId,
        modifierOptionId: m.optionId,
        groupName: m.groupName,
        optionName: m.optionName,
        priceAdjustment: m.priceAdjustment / 100,
      })),
    };
  });
}

function totals(cart: CartState, isVatRegistered: boolean) {
  const lines = activeLines(cart);
  const subtotalCents = lines.reduce((s, l) => s + l.lineTotal, 0);
  const totalCents = subtotalCents; // discounts handled separately when wired
  const vatAmountCents = isVatRegistered
    ? Math.round(totalCents - totalCents / (1 + VAT_RATE))
    : 0;
  return {
    subtotal: subtotalCents / 100,
    discountAmount: 0,
    vatAmount: vatAmountCents / 100,
    totalAmount: totalCents / 100,
  };
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
      discounts: [],
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
