import { Prisma } from '@prisma/client';

/**
 * Rules a receiving draft shares between the moment an API key makes it
 * (ServiceDraftsService.draftReceiving) and the moment a person confirms it
 * (ReceivingDraftsService.confirm).
 */

/** One invoice line as a draft keeps it (ReceivingDraft.lines). Numbers as strings, as sent. */
export interface ReceivingLine {
  itemId:    string;
  kind:      'raw';
  /** In the item's own unit, 4 decimals. */
  qty:       string;
  /** Per unit, NET of VAT when the invoice is vatable, 4 decimals. */
  unitCost:  string;
  lineTotal: string;
  uom:       string | null;
  printed:   string | null;
}

type Db = Pick<Prisma.TransactionClient, 'vendor' | 'aPBill' | 'rawMaterialLot' | 'receivingDraft'>;

const digits = (tin: string | null | undefined) => (tin ?? '').replace(/\D/g, '');

/** Same TIN: every digit, or the 9-digit base when one side leaves the branch code off. */
export function sameTin(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = digits(a);
  const y = digits(b);
  if (x.length < 9 || y.length < 9) return false;
  return x === y || ((x.length === 9 || y.length === 9) && x.slice(0, 9) === y.slice(0, 9));
}

/** The tenant's own active supplier this invoice is from: by TIN first, else by name (case ignored). */
export async function matchVendor(db: Db, tenantId: string, name: string, tin: string | null) {
  if (tin) {
    const withTin = await db.vendor.findMany({
      where:  { tenantId, isActive: true, tin: { not: null } },
      select: { id: true, name: true, tin: true },
    });
    const hit = withTin.find((v) => sameTin(v.tin, tin));
    if (hit) return hit;
  }
  return db.vendor.findFirst({
    where:  { tenantId, isActive: true, name: { equals: name, mode: 'insensitive' } },
    select: { id: true, name: true, tin: true },
  });
}

/** An invoice number as printed, without case, spaces or punctuation: "SI-0123", "si 0123" and "SI0123" are one. */
export function invoiceKey(n: string | null | undefined): string {
  const raw = (n ?? '').trim();
  const key = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return key || raw.toUpperCase();
}

/** Same invoice number, read the way a person would: case, spaces and punctuation ignored. */
export function sameInvoice(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = invoiceKey(a);
  return x !== '' && x === invoiceKey(b);
}

/**
 * Has this supplier's invoice number been received already? Returns why, or
 * null. Numbers are compared with sameInvoice, so "SI-0123" typed on the
 * screen and "si 0123" read from the photo are the same invoice. Three places
 * say so:
 *   - an AP bill from this vendor under that invoice number, not voided or
 *     cancelled (Clerque's receiving on credit files the invoice number as
 *     the bill's vendorBillRef);
 *   - a lot of one of these items under that number (a delivery received on
 *     the screen with the invoice number as its reference);
 *   - another receiving draft of the same supplier's invoice that was not
 *     cancelled.
 */
export async function findDuplicateInvoice(
  db: Db,
  tenantId: string,
  q: { invoiceNumber: string; vendorId: string | null; supplierName: string; supplierTin: string | null; itemIds: string[]; excludeDraftId?: string },
): Promise<string | null> {
  if (q.vendorId) {
    const bills = await db.aPBill.findMany({
      where:  { tenantId, vendorId: q.vendorId, vendorBillRef: { not: null }, status: { notIn: ['VOIDED', 'CANCELLED'] } },
      select: { billNumber: true, vendorBillRef: true },
    });
    const bill = bills.find((b) => sameInvoice(b.vendorBillRef, q.invoiceNumber));
    if (bill) return `Invoice ${q.invoiceNumber} from ${q.supplierName} is already received (bill ${bill.billNumber}).`;
  }
  if (q.itemIds.length) {
    const lots = await db.rawMaterialLot.findMany({
      where:    { tenantId, rawMaterialId: { in: q.itemIds }, referenceNumber: { not: null } },
      select:   { referenceNumber: true },
      distinct: ['referenceNumber'],
    });
    if (lots.some((l) => sameInvoice(l.referenceNumber, q.invoiceNumber))) {
      return `Stock was already received under invoice ${q.invoiceNumber} for an item on this invoice.`;
    }
  }
  const drafts = await db.receivingDraft.findMany({
    where: {
      tenantId, status: { not: 'CANCELLED' },
      ...(q.excludeDraftId ? { id: { not: q.excludeDraftId } } : {}),
    },
    select: { reference: true, invoiceNumber: true, vendorId: true, supplierName: true, supplierTin: true },
  });
  const same = drafts.find((d) => sameInvoice(d.invoiceNumber, q.invoiceNumber) && (
    (q.vendorId && d.vendorId === q.vendorId)
    || sameTin(d.supplierTin, q.supplierTin)
    || d.supplierName.trim().toLowerCase() === q.supplierName.trim().toLowerCase()));
  if (same) return `Invoice ${q.invoiceNumber} from ${q.supplierName} is already a receiving draft (reference ${same.reference}).`;
  return null;
}

/**
 * The per-unit cost Clerque's receiving expects: what the supplier CHARGED
 * per unit. InventoryService.receiveRawMaterial takes the charged price and
 * takes the 12% back out itself for a VAT-registered shop (and keeps it in
 * the cost for any other). The draft holds the invoice's unit cost net of
 * VAT, so a vatable line goes back to the charged price here.
 */
export function chargedUnitCost(line: Pick<ReceivingLine, 'unitCost'>, vatable: boolean): number {
  const net = new Prisma.Decimal(line.unitCost);
  return (vatable ? net.times('1.12') : net).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP).toNumber();
}
