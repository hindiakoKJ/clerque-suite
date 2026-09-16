import { releasedHolds } from './released-holds';

/**
 * What waiting tickets let go of since a count was opened, without being made.
 *
 * The count's expected figures were taken less what those tickets held. A
 * ticket voided or refunded since was never made, so its share has to go back
 * onto what the count expected; a ticket marked ready took its share off the
 * book itself and gives nothing back; a ticket that held nothing at the
 * opening has nothing to give.
 */

const TENANT = 't1';
const BRANCH = 'b1';
const OPENED = new Date('2026-09-16T02:00:00Z');
const BEFORE = new Date('2026-09-16T01:00:00Z');
const AFTER  = new Date('2026-09-16T03:00:00Z');
const LATER  = new Date('2026-09-16T04:00:00Z');

interface Ticket {
  productId?: string;
  variantId?: string | null;
  quantity?: number;
  usageOnReady?: boolean;
  usagePostedAt?: Date | null;
  status?: string;
  paidAt?: Date | null;
  voidedAt?: Date | null;
  deletedAt?: Date | null;
  branchId?: string;
  refunds?: Array<{ quantity: number; createdAt: Date }>;
}

/*
  The line query answered the way the database would: every filter the helper
  sends is applied, so a line the query wrongly left out would show up here as
  a missing give-back, not pass because the fake returned everything.
*/
function build(tickets: Ticket[]) {
  const rows = tickets.map((t) => ({
    productId: t.productId ?? 'latte', variantId: t.variantId ?? null, quantity: t.quantity ?? 1,
    usageOnReady: t.usageOnReady ?? true, usagePostedAt: t.usagePostedAt ?? null, modifiers: [],
    order: {
      tenantId: TENANT, branchId: t.branchId ?? BRANCH, status: t.status ?? 'PAID',
      paidAt: t.paidAt === undefined ? BEFORE : t.paidAt, voidedAt: t.voidedAt ?? null, deletedAt: t.deletedAt ?? null,
    },
    refunds: t.refunds ?? [],
  }));
  const matches = (where: any, r: (typeof rows)[number]) => {
    if (r.usageOnReady !== where.usageOnReady) return false;
    const ready = where.OR.some((o: any) => (o.usagePostedAt === null
      ? r.usagePostedAt == null
      : r.usagePostedAt != null && r.usagePostedAt >= o.usagePostedAt.gte));
    if (!ready) return false;
    const o = where.order;
    if (r.order.tenantId !== o.tenantId || r.order.branchId !== o.branchId) return false;
    if (o.deletedAt === null && r.order.deletedAt != null) return false;
    if (!(r.order.paidAt != null && r.order.paidAt < o.paidAt.lt)) return false;
    if (!o.status.in.includes(r.order.status)) return false;
    return where.AND.every((a: any) => a.OR.some((alt: any) => (alt.order
      ? r.order.voidedAt != null && r.order.voidedAt >= alt.order.voidedAt.gte
      : r.refunds.some((f) => f.createdAt >= alt.refunds.some.createdAt.gte))));
  };
  const db: any = {
    orderItem: { findMany: jest.fn(async ({ where }: any) => rows.filter((r) => matches(where, r))) },
    bomItem: {
      findMany: jest.fn(async () => [
        { productId: 'latte', rawMaterialId: 'milk', quantity: 200, rawMaterial: null },
        { productId: 'latte', rawMaterialId: 'espresso', quantity: 18, rawMaterial: null },
      ]),
    },
    variantBomItem: { findMany: jest.fn(async () => [{ variantId: 'large', rawMaterialId: 'milk', quantity: 300, rawMaterial: null }]) },
    modifierOption: { findMany: jest.fn(async () => []) },
  };
  return db;
}

const released = (tickets: Ticket[], ids = ['milk']) => releasedHolds(build(tickets), TENANT, BRANCH, ids, OPENED);

describe('releasedHolds', () => {
  describe('voided after the count opened', () => {
    it('hands back everything the ticket still held, by its own recipe', async () => {
      const out = await released([
        { quantity: 2, status: 'VOIDED', voidedAt: AFTER },
        { variantId: 'large', status: 'VOIDED', voidedAt: AFTER },   // a Large: its size recipe
      ]);
      expect(out.get('milk')).toBe(700);
    });

    it('leaves out units already refunded before the opening -- the snapshot never held them', async () => {
      const out = await released([
        { quantity: 3, status: 'VOIDED', voidedAt: AFTER, refunds: [{ quantity: 1, createdAt: BEFORE }, { quantity: 1, createdAt: AFTER }] },
      ]);
      // Held 2 at the opening; the refund since and the void let go of both.
      expect(out.get('milk')).toBe(400);
    });
  });

  describe('refunded after the count opened', () => {
    it('hands back only the refunded units', async () => {
      const out = await released([{ quantity: 3, status: 'PAID', refunds: [{ quantity: 1, createdAt: AFTER }] }]);
      expect(out.get('milk')).toBe(200);
    });

    it('hands back nothing for a refund made before the opening', async () => {
      const db = build([{ quantity: 3, status: 'COMPLETED', refunds: [{ quantity: 2, createdAt: BEFORE }] }]);
      const out = await releasedHolds(db, TENANT, BRANCH, ['milk'], OPENED);
      expect(out.size).toBe(0);
      expect(db.bomItem.findMany).not.toHaveBeenCalled();
    });
  });

  describe('marked ready after the count opened', () => {
    it('hands back nothing: the tap took its share off the book', async () => {
      const out = await released([
        { quantity: 2, status: 'COMPLETED', usagePostedAt: AFTER },
        // Made, then voided: that is waste, not a hold let go of.
        { quantity: 1, status: 'VOIDED', usagePostedAt: AFTER, voidedAt: LATER },
      ]);
      expect(out.size).toBe(0);
    });

    it('hands back a refund made before the tap, but not one made after it', async () => {
      const out = await released([{
        quantity: 3, status: 'COMPLETED', usagePostedAt: LATER,
        refunds: [{ quantity: 1, createdAt: AFTER }, { quantity: 1, createdAt: new Date('2026-09-16T05:00:00Z') }],
      }]);
      expect(out.get('milk')).toBe(200);
    });
  });

  it('leaves out a ticket that held nothing when the count opened', async () => {
    const out = await released([
      { status: 'VOIDED', voidedAt: BEFORE },                                          // voided before
      { paidAt: AFTER, status: 'VOIDED', voidedAt: LATER },                            // paid after
      { usagePostedAt: BEFORE, status: 'COMPLETED', refunds: [{ quantity: 1, createdAt: AFTER }] }, // made before
      { status: 'VOIDED', voidedAt: AFTER, refunds: [{ quantity: 1, createdAt: BEFORE }] },         // refunded away before
      { usageOnReady: false, status: 'VOIDED', voidedAt: AFTER },                      // used at the sale
      { branchId: 'b2', status: 'VOIDED', voidedAt: AFTER },                           // another branch
    ]);
    expect(out.size).toBe(0);
  });

  it('answers only for the ingredients asked about, and asks nothing when there are none', async () => {
    const out = await released([{ status: 'VOIDED', voidedAt: AFTER }], ['espresso']);
    expect(out.get('espresso')).toBe(18);
    expect(out.has('milk')).toBe(false);

    const db = build([{ status: 'VOIDED', voidedAt: AFTER }]);
    expect(await releasedHolds(db, TENANT, BRANCH, [], OPENED)).toEqual(new Map());
    expect(db.orderItem.findMany).not.toHaveBeenCalled();
  });
});
