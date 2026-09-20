import { Prisma } from '@prisma/client';

/**
 * The average cost after stock comes in, with a ₱0 never averaged in.
 *
 * A zero on either side of the average is "no price", not a real price.
 * Averaged in, it drags the cost of every plate down and keeps it there:
 * 1 kg of Soy sauce loaded at ₱0, then 1 kg bought at ₱400, averaged to
 * ₱0.20/g instead of ₱0.40/g. So:
 *
 *   - both priced:              the ordinary weighted average;
 *   - stock on hand at ₱0, the delivery priced: the delivery's price, and
 *     the stock that was sitting at no value is valued at it;
 *   - the delivery at ₱0, a price on file: the price on file stays, and the
 *     delivery is valued at it;
 *   - neither priced:           nothing to change.
 *
 * `valued` is what the books have not carried yet. The caller queues it as
 * opening stock (Dr the item's account / Cr 3010 Owner's Capital), so the
 * stock account keeps agreeing with stock × average cost. Without it, every
 * later sale would take that stock out of the account at a price it was
 * never put in at.
 */
export interface Blend {
  /** The new average cost, or null to leave the one on file as it is. */
  cost:   number | null;
  /** Stock now carrying a price the books have not recorded yet. */
  valued: { quantity: number; unitCost: number } | null;
}

export function blendCost(a: { qtyBefore: number; oldCost: number; qtyIn: number; inCost: number }): Blend {
  const { qtyBefore, oldCost, qtyIn, inCost } = a;
  if (inCost > 0 && oldCost > 0) {
    const qtyAfter = qtyBefore + qtyIn;
    return {
      cost:   qtyAfter > 0 ? (qtyBefore * oldCost + qtyIn * inCost) / qtyAfter : inCost,
      valued: null,
    };
  }
  if (inCost > 0) {
    return { cost: inCost, valued: qtyBefore > 0 ? { quantity: qtyBefore, unitCost: inCost } : null };
  }
  if (oldCost > 0) {
    return { cost: null, valued: qtyIn > 0 ? { quantity: qtyIn, unitCost: oldCost } : null };
  }
  return { cost: null, valued: null };
}

/**
 * The accounting event that books `Blend.valued`, or null when it rounds to
 * nothing. Same shape as an opening count (warehouse.service), so the journal
 * routes it the same way: the item's own account, credited to Owner's Capital.
 */
export function stockValuedEvent(a: {
  tenantId:  string;
  material:  { id: string; name: string; category: unknown; unit: string };
  branchId:  string;
  quantity:  number;
  unitCost:  number;
  at:        Date;
  reference?: string | null;
}): Prisma.AccountingEventUncheckedCreateInput | null {
  const totalValue = +(a.quantity * a.unitCost).toFixed(2);
  if (!(totalValue > 0)) return null;
  return {
    tenantId: a.tenantId,
    type:     'INVENTORY_ADJUSTMENT',
    status:   'PENDING',
    payload: {
      kind:            'RAW_MATERIAL_RECEIPT',
      rawMaterialId:   a.material.id,
      rawMaterialName: a.material.name,
      category:        (a.material.category as string | null) ?? null,
      unit:            a.material.unit,
      quantity:        a.quantity,
      unitCost:        a.unitCost,
      totalValue,
      branchId:        a.branchId,
      reasonCode:      'OPENING_BALANCE',
      referenceNumber: a.reference ?? null,
      receivedAt:      a.at.toISOString(),
      // Legacy fields the journal handler reads
      productName:     a.material.name,
      adjustmentType:  'OPENING_BALANCE',
      reason:          'Stock that had no cost, now valued',
    } as Prisma.JsonObject,
  };
}
