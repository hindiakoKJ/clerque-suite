import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { OfflineOrder } from '@repo/shared-types';
import type { PrismaService } from '../prisma/prisma.service';
import {
  needsNamedBuyer, partKind, readDetails, tagLineNote, tagNumberFromNote, whyNotSellable,
} from '../tags/tag-rules';

/**
 * Selling tags at Counter (Clerque Inventory, Phase 1 -- tasks/inventory-phase1-api.md).
 *
 * A tagged part is sold once, by its printed number, at its own cost. Before
 * the sale is saved, planTagSale checks every tag line (and refuses, on a live
 * sale, what the shop's rules forbid); inside the sale's transaction,
 * claimTags moves each tag to SOLD with one conditional update, so two phones
 * can never sell the same part. A sale rung offline is never refused when it
 * syncs: a clash becomes an alert to the owner.
 */

const PHOTO_ENTITY = 'SerializedUnit';

export interface TagLine {
  id: string;
  number: string;
  productId: string;
  cost: number | null;
  note: string;
}

export interface TagPlan {
  /** Payload line index -> its tag. */
  byIndex: Map<number, TagLine>;
  /** Tag number -> its own cost, for the order line's cost of record. */
  costByNumber: Map<string, number>;
}

const EMPTY: TagPlan = { byIndex: new Map(), costByNumber: new Map() };

type Db = Pick<PrismaService, 'serializedUnit' | 'document' | 'tenant'>;

export async function planTagSale(
  db: Db,
  tenantId: string,
  payload: OfflineOrder,
  live: boolean,
  /** Does this shop tag anything at all? False skips every query: a cafe's sale pays nothing for this. */
  shopUsesTags: boolean,
): Promise<TagPlan> {
  const tagIdx = payload.items
    .map((it, idx) => ({ id: it.serializedUnitId, idx }))
    .filter((x): x is { id: string; idx: number } => typeof x.id === 'string' && x.id.length > 0);

  // A plain line for a product sold by tag hides which piece left: refuse it on
  // a live sale. Medical-equipment shops are exempt: their rentals use the
  // same units table and they sell those products as plain lines.
  if (live && shopUsesTags) {
    const plainProducts = [...new Set(payload.items.filter((it) => !it.serializedUnitId).map((it) => it.productId))];
    if (plainProducts.length) {
      const tagged = await db.serializedUnit.groupBy({
        by: ['productId'],
        where: { tenantId, branchId: payload.branchId, productId: { in: plainProducts }, status: 'IN_STOCK', acquiredCost: { not: null } },
      });
      if (tagged.length) {
        const tenant = await db.tenant.findUnique({ where: { id: tenantId }, select: { businessType: true } });
        if (tenant?.businessType !== 'MEDICAL_EQUIPMENT') {
          const names = payload.items.filter((it) => !it.serializedUnitId && tagged.some((t) => t.productId === it.productId)).map((it) => it.productName);
          throw new BadRequestException({
            code: 'SELL_BY_TAG',
            message: `Sell ${[...new Set(names)].join(', ')} by its tag: type or scan the number on the part's label.`,
          });
        }
      }
    }
  }
  if (tagIdx.length === 0) return EMPTY;

  const ids = [...new Set(tagIdx.map((t) => t.id))];
  if (ids.length !== tagIdx.length) {
    throw new BadRequestException({ code: 'TAG_TWICE_IN_CART', message: 'The same tagged part is in the cart twice.' });
  }
  const [rows, photos] = await Promise.all([
    db.serializedUnit.findMany({
      where: { id: { in: ids }, tenantId },
      select: {
        id: true, serialNumber: true, productId: true, branchId: true, status: true, acquiredCost: true, conditionNotes: true,
        product: { select: { sku: true } },
      },
    }),
    db.document.groupBy({ by: ['entityId'], where: { tenantId, entityType: PHOTO_ENTITY, entityId: { in: ids } }, _count: { _all: true } }),
  ]);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const photoCount = new Map(photos.map((p) => [p.entityId, p._count._all]));

  const plan: TagPlan = { byIndex: new Map(), costByNumber: new Map() };
  let namedBuyerNeeded = false;
  for (const { id, idx } of tagIdx) {
    const item = payload.items[idx];
    const tag = byId.get(id);
    if (!tag || tag.productId !== item.productId) {
      throw new BadRequestException({ code: 'TAG_NOT_FOUND', message: `${item.productName}: that tag is not this product's, or does not exist.` });
    }
    if (Number(item.quantity) !== 1) {
      throw new BadRequestException({ code: 'TAG_QUANTITY', message: `Tag ${tag.serialNumber} is one piece: its quantity must be 1.` });
    }
    if (live) {
      const why = whyNotSellable(
        { status: tag.status, acquiredCost: tag.acquiredCost, branchId: tag.branchId, photoCount: photoCount.get(id) ?? 0 },
        payload.branchId,
      );
      if (why) throw new BadRequestException({ code: 'TAG_NOT_SELLABLE', message: `Tag ${tag.serialNumber}: ${why}` });
    }
    if (needsNamedBuyer(partKind(tag.product.sku))) namedBuyerNeeded = true;
    const cost = tag.acquiredCost != null ? Number(tag.acquiredCost) : null;
    plan.byIndex.set(idx, { id, number: tag.serialNumber, productId: tag.productId, cost, note: tagLineNote(tag.serialNumber, readDetails(tag.conditionNotes)) });
    if (cost != null) plan.costByNumber.set(tag.serialNumber, cost);
  }

  if (live) {
    // Engines and pieces with a chassis number: the law wants a named buyer (RA 10883 s.10).
    if (namedBuyerNeeded && (!payload.customerName?.trim() || !payload.customerAddress?.trim())) {
      throw new BadRequestException({
        code: 'TAG_BUYER_REQUIRED',
        message: "An engine, half-cut or frame piece needs the buyer's name and address on the sale.",
      });
    }
    // Tagged money goes to the shop, traceably: never to a personal wallet, never without a reference.
    for (const p of payload.payments) {
      const m = String(p.method);
      if (m === 'GCASH_PERSONAL' || m === 'MAYA_PERSONAL') {
        throw new BadRequestException({ code: 'TAG_PERSONAL_WALLET', message: "A tagged part is paid to the shop's business GCash or Maya, not a personal one." });
      }
      if ((m.startsWith('GCASH') || m.startsWith('MAYA') || m === 'QR_PH') && !p.reference?.trim()) {
        throw new BadRequestException({ code: 'TAG_PAYMENT_REFERENCE', message: 'Type the GCash, Maya or QR Ph reference number for this payment.' });
      }
    }
  }
  return plan;
}

/**
 * Inside the sale's transaction: each tag goes from IN_STOCK to SOLD with this
 * order, in one conditional update. A live sale fails unless exactly one row
 * changes. A replayed offline sale keeps going and reports the clash.
 */
export async function claimTags(
  tx: Prisma.TransactionClient,
  tenantId: string,
  orderId: string,
  plan: TagPlan,
  live: boolean,
): Promise<string[]> {
  const clashes: string[] = [];
  for (const tag of plan.byIndex.values()) {
    const moved = await tx.serializedUnit.updateMany({
      where: { id: tag.id, tenantId, status: 'IN_STOCK', acquiredCost: { not: null } },
      data: { status: 'SOLD', soldOrderId: orderId },
    });
    if (moved.count !== 1) {
      if (live) throw new ConflictException({ code: 'TAG_ALREADY_SOLD', message: `Tag ${tag.number} was already sold.` });
      clashes.push(tag.number);
    }
  }
  return clashes;
}

/**
 * A void or refund of a tagged line: the part is back on the shelf
 * (IN_STOCK) when it came back, or written off (RETIRED) when it did not.
 */
export async function releaseTag(
  tx: Prisma.TransactionClient,
  tenantId: string,
  orderId: string,
  lineNote: string | null | undefined,
  backOnShelf: boolean,
): Promise<string | null> {
  const number = tagNumberFromNote(lineNote);
  if (!number) return null;
  await tx.serializedUnit.updateMany({
    where: { tenantId, serialNumber: number, soldOrderId: orderId, status: 'SOLD' },
    data: backOnShelf ? { status: 'IN_STOCK', soldOrderId: null } : { status: 'RETIRED' },
  });
  return number;
}
