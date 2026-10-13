/**
 * Tags: one physical piece with a printed 6-digit label number (Clerque
 * Inventory, Phase 1 -- tasks/inventory-phase1-api.md).
 *
 * A tag is a SerializedUnit row whose serialNumber is the label number, so
 * Phase 1 needs no database change. The rules here are pure so the service,
 * the sale and the tests all read the same ones.
 */

/** Label numbers are exactly six digits: never mistaken for a 8/12/13/14-digit retail barcode. */
export const TAG_NUMBER = /^\d{6}$/;

export function isTagNumber(code: string): boolean {
  return TAG_NUMBER.test(code);
}

export function formatTagNumber(n: number): string {
  return String(n).padStart(6, '0');
}

/**
 * What kind of part a product is, from the SKU prefix the owner gives it.
 * Engines and the pieces that carry a chassis number are controlled by law
 * (RA 10883 s.10 stock records, s.7/s.15 identity of a vehicle), so they need
 * their number at tagging and a named buyer at sale.
 */
export type PartKind = 'ENGINE' | 'HALF_CUT' | 'FRAME_PIECE' | 'PART';

export function partKind(sku: string | null | undefined): PartKind {
  const s = (sku ?? '').trim().toUpperCase();
  if (s.startsWith('ENG-')) return 'ENGINE';
  if (s.startsWith('HC-')) return 'HALF_CUT';
  if (s.startsWith('FRM-')) return 'FRAME_PIECE';
  return 'PART';
}

/** Engines, half-cuts and frame pieces: the buyer's name and address go on the sale. */
export function needsNamedBuyer(kind: PartKind): boolean {
  return kind !== 'PART';
}

/**
 * What a tag carries besides its number, kept as JSON in
 * SerializedUnit.conditionNotes (free text for medical-equipment rentals, so a
 * row that is not JSON reads as plain notes).
 */
export interface TagDetails {
  engineNumber?:  string | null;
  chassisNumber?: string | null;
  notes?:         string | null;
}

export function readDetails(conditionNotes: string | null | undefined): TagDetails {
  if (!conditionNotes) return {};
  try {
    const v = JSON.parse(conditionNotes);
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return {
        engineNumber:  typeof v.engineNumber === 'string' ? v.engineNumber : null,
        chassisNumber: typeof v.chassisNumber === 'string' ? v.chassisNumber : null,
        notes:         typeof v.notes === 'string' ? v.notes : null,
      };
    }
  } catch {
    /* plain text */
  }
  return { notes: conditionNotes };
}

export function writeDetails(d: TagDetails): string {
  return JSON.stringify({
    engineNumber:  d.engineNumber?.trim() || null,
    chassisNumber: d.chassisNumber?.trim() || null,
    notes:         d.notes?.trim() || null,
  });
}

/** What the receipt and the owner's alert print for a sold tag. */
export function tagLineNote(number: string, d: TagDetails): string {
  const parts = [`Tag ${number}`];
  if (d.engineNumber) parts.push(`Engine No. ${d.engineNumber}`);
  if (d.chassisNumber) parts.push(`Chassis No. ${d.chassisNumber}`);
  return parts.join(' · ');
}

/** The tag number back out of a sold line's notes (for voids and refunds). */
export function tagNumberFromNote(note: string | null | undefined): string | null {
  const m = /\bTag (\d{6})\b/.exec(note ?? '');
  return m ? m[1] : null;
}

export type TagState = 'WAITING_FOR_COST' | 'IN_STOCK' | 'SOLD' | 'RETIRED' | 'OTHER';

/** A tag is waiting for cost until the owner costs it: tagged, photographed, not yet stock. */
export function tagState(status: string, acquiredCost: unknown): TagState {
  if (status === 'IN_STOCK') return acquiredCost == null ? 'WAITING_FOR_COST' : 'IN_STOCK';
  if (status === 'SOLD' || status === 'RETIRED') return status;
  return 'OTHER';
}

/** Why a tag cannot be sold right now, in words for the cashier; null when it can. */
export function whyNotSellable(
  t: { status: string; acquiredCost: unknown; branchId: string; photoCount: number },
  saleBranchId?: string | null,
): string | null {
  const state = tagState(t.status, t.acquiredCost);
  if (state === 'SOLD') return 'This part was already sold.';
  if (state === 'RETIRED') return 'This part was written off.';
  if (state === 'OTHER') return 'This tag is not for sale (rental or repair).';
  if (state === 'WAITING_FOR_COST') return 'The owner has not set this part\'s cost yet.';
  if (t.photoCount < 1) return 'This part has no photo yet. Take one before selling.';
  if (saleBranchId && t.branchId !== saleBranchId) return 'This part is at another branch.';
  return null;
}
