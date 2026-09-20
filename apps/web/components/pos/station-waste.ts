/**
 * "Thrown out" on a kitchen or bar screen's Today's inventory: the reasons the
 * cook picks from and the amount they type, in the item's own unit, with a
 * pack button for things bought by the pack. Pure, so Node's own test runner
 * checks it:
 *   cd apps/web && node --test components/pos/station-waste.spec.mjs
 *
 * The server books it through the same write-off as Procure > Stock
 * (POST /kds/stations/:id/waste). No costs anywhere.
 */

export const WASTE_REASONS = [
  { code: 'SPOILED', label: 'Spoiled' },
  { code: 'EXPIRED', label: 'Past its date' },
  { code: 'DROPPED', label: 'Dropped or spilled' },
  { code: 'OTHER',   label: 'Other' },
] as const;
export type WasteReason = (typeof WASTE_REASONS)[number]['code'];

/** Stock is kept to 4 decimal places. */
const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

/**
 * What the cook typed, as an amount: "1,500" and "1.5" and "0.25" read; blank,
 * zero, a minus, letters or two dots do not (null).
 */
export function parseWasteAmount(text: string): number | null {
  const t = text.replace(/,/g, '').trim();
  if (!/^(\d+\.?\d*|\.\d+)$/.test(t)) return null;
  const n = round4(Number(t));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** "1,000" -- how an amount reads on the screen. */
export function wasteNumber(n: number): string {
  return n.toLocaleString('en-PH', { maximumFractionDigits: 4 });
}

/** One more pack onto what is typed already: "" -> "1000", "250" -> "1250". */
export function addPack(text: string, packSize: number): string {
  return String(round4((parseWasteAmount(text) ?? 0) + packSize));
}

/** The pack button: "+ 1 pack (1,000 ml)". Null for an item never bought by the pack. */
export function packButtonLabel(packSize: number | null, unit: string): string | null {
  return packSize != null && packSize > 0 ? `+ 1 pack (${wasteNumber(packSize)} ${unit})` : null;
}

/** The typed amount in packs, the way the sheet writes it: "1 pk + 250 g". Null below one pack or with no pack size. */
export function inPacks(qty: number, unit: string, packSize: number | null): string | null {
  if (packSize == null || !(packSize > 0) || qty < packSize) return null;
  const packs = Math.floor(qty / packSize + 1e-9);
  const rest = round4(qty - packs * packSize);
  return `${packs} pk${rest > 0 ? ` + ${wasteNumber(rest)} ${unit}` : ''}`;
}

/** What Save sends, or null while the amount or the reason is still missing. */
export function wasteRequest(input: { rawMaterialId: string; amount: string; reason: WasteReason | null; note: string; key: string }):
  { rawMaterialId: string; qty: number; reason: WasteReason; note?: string; key: string } | null {
  const qty = parseWasteAmount(input.amount);
  if (qty == null || !input.reason) return null;
  const note = input.note.trim();
  return { rawMaterialId: input.rawMaterialId, qty, reason: input.reason, ...(note ? { note } : {}), key: input.key };
}
