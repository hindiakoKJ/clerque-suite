import { cleanSourceName, sourceKindFromLabel, SOURCE_KINDS, SOURCE_KIND_LABEL, type SourceKind } from '@repo/shared-types';
import { unitFactor, normUnit } from '../inventory/unit-conversion';

/**
 * What an uploaded buy-list sheet would change, row by row, before anything
 * is written.
 *
 * The Excel file is the backup, not a second front door: it may RECORD what
 * was bought -- fill in packs, pack size, price, brand and where it was bought
 * on a line not yet in stock, or add a purchase made away from the app -- and
 * nothing more.
 * Stock goes in only when someone taps "Post to stock" on the request, and
 * money only moves in Clerque: anything that would correct a paid-ahead order
 * is refused here and done on the request.
 *
 * A cell counts as changed when it differs from what the file was downloaded
 * with (hidden "was" columns), not from what Clerque holds now. An old file
 * uploaded again must not undo a correction made in the app since; when both
 * changed, the row is refused and the file has to be downloaded again.
 *
 * Pure: the rows, the lines they point at and the shop's ingredients go in; a
 * verdict per row comes out, with the real Excel row number and the reason in
 * words. The service applies the verdicts.
 */

/** One data row of the Lines sheet, as read -- strings exactly as typed. */
export interface SheetRow {
  /** The row number Excel shows, so a refusal can say where to look. */
  rowNumber: number;
  lineNumber: string;
  branch: string;
  item: string;
  boughtOn: string;
  packs: string;
  packSize: string;
  packUnit: string;
  pricePerPack: string;
  brand: string;
  /** Where it was bought, in words: Palengke, Grocery, Online, Supplier, Other. */
  boughtAt: string;
  /** The store itself: "Puregold", "Shopee". */
  store: string;
  /** Excel turned what was typed under Store into a date ("7-11" became 11-Jul); what was typed cannot be recovered. */
  storeIsDate?: boolean;
  /** A spare row's hidden key: once recorded, the purchase is found by it again. */
  rowKey: string;
  /**
   * What the row held when the file was downloaded; null for a file without
   * those columns. boughtAt and store are absent on a file made before those
   * columns existed.
   */
  was: {
    item: string; boughtOn: string; packs: string; packSize: string; pricePerPack: string; brand: string;
    boughtAt?: string; store?: string;
  } | null;
}

/** A line already on a request, with what the sheet may compare against. */
export interface ExistingLine {
  lineId: string;
  lineNumber: string;
  requestId: string;
  requestNumber: string;
  requestStatus: string;
  /** The request was paid on order day: a price change there is a ledger correction, made on the request. */
  prepaid: boolean;
  /** The request was created from an earlier upload. */
  fromSheet: boolean;
  /** The spare-row key this line was recorded from, when it was. */
  sheetRowKey: string | null;
  branchId: string;
  branchName: string;
  rawMaterialId: string;
  itemName: string;
  unit: string;
  packsBought: number | null;
  packSize: number | null;
  packCost: number | null;
  brandNote: string | null;
  sourceKind: string | null;
  sourceName: string | null;
  boughtOn: string | null;
  receivedAt: Date | null;
}

export interface SheetMaterial { id: string; name: string; unit: string; isActive: boolean; isPrep: boolean }
export interface SheetBranch { id: string; name: string }

export type PlanVerdict =
  | { kind: 'UNCHANGED'; rowNumber: number; lineNumber: string; item: string }
  | { kind: 'FILL'; rowNumber: number; lineNumber: string; item: string; unit: string; lineId: string; requestId: string;
      packsBought: number; packSize: number; packCost: number; brandNote: string | null; boughtOn: string | null;
      sourceKind: SourceKind | null; sourceName: string | null }
  | { kind: 'NEW'; rowNumber: number; item: string; unit: string; branchId: string; branchName: string; rawMaterialId: string; boughtOn: string;
      packsBought: number; packSize: number; packCost: number; brandNote: string | null; rowKey: string | null;
      sourceKind: SourceKind | null; sourceName: string | null }
  | { kind: 'REFUSED'; rowNumber: number; lineNumber: string; item: string; reason: string };

export interface PlanInput {
  rows: SheetRow[];
  lines: ExistingLine[];
  materials: SheetMaterial[];
  branches: SheetBranch[];
  /** Owner, manager or MDM: only they may add a purchase that is on no request. */
  canAddNew: boolean;
  /** YYYY-MM-DD in the shop's time zone. */
  today: string;
}

const EPS = 1e-4;
const same = (a: number | null, b: number | null) => (a == null && b == null) || (a != null && b != null && Math.abs(a - b) < EPS);
const clean = (s: string) => (s ?? '').trim();
const key = (s: string) => clean(s).toLowerCase();

/** A number as typed, or null when blank; NaN when it is not a number. */
function numberOf(raw: string): number | null {
  const s = (raw ?? '').replace(/,/g, '').replace(/₱|php/gi, '').trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

/** YYYY-MM-DD, or null when blank; 'bad' when it is not a real date. */
function dayOf(raw: string): string | null | 'bad' {
  const s = clean(raw);
  if (s === '') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return 'bad';
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? 'bad' : s;
}

const UNIT_HINT: Record<string, string> = { g: ' or kg', ml: ' or L' };
const KIND_WORDS = SOURCE_KINDS.map((k) => SOURCE_KIND_LABEL[k]).join(', ');
/** A stored kind, only when it is one of ours. */
const kindOf = (v: string | null | undefined): SourceKind | null => (v && (SOURCE_KINDS as readonly string[]).includes(v) ? (v as SourceKind) : null);

/**
 * Pack size in the ingredient's own unit. A pack typed "1" with unit "L" on a
 * millilitre ingredient is 1,000; "bottle" on a millilitre ingredient cannot
 * be converted and is refused rather than guessed.
 */
function inItemUnit(size: number, packUnit: string, itemUnit: string): number | string {
  const typed = clean(packUnit);
  if (typed === '' || normUnit(typed) === normUnit(itemUnit)) return size;
  const factor = unitFactor(typed, itemUnit);
  if (factor == null) return `Pack size has to be in ${itemUnit}${UNIT_HINT[normUnit(itemUnit)] ?? ''} ("${typed}" cannot be converted).`;
  return +(size * factor).toFixed(4);
}

export function planBuyListRows(input: PlanInput): PlanVerdict[] {
  const out: PlanVerdict[] = [];
  const byNumber = new Map(input.lines.map((l) => [key(l.lineNumber), l]));
  const byRowKey = new Map(input.lines.filter((l) => l.sheetRowKey).map((l) => [l.sheetRowKey!, l]));
  const branchName = (id: string) => input.branches.find((b) => b.id === id)?.name ?? id;
  const seenNumbers = new Map<string, number>();
  const seenKeys = new Map<string, number>();
  const seenNew = new Map<string, number>();
  /** Every line a verdict already fills: two rows filling one line would silently overwrite each other. */
  const claimed = new Map<string, number>();
  /** One bought-on date per request: rows of one request that disagree would keep flipping it. */
  const requestDay = new Map<string, { day: string; row: number }>();

  for (const row of input.rows) {
    const lineNumber = clean(row.lineNumber);
    const item = clean(row.item);
    const refuse = (reason: string): void => { out.push({ kind: 'REFUSED', rowNumber: row.rowNumber, lineNumber, item, reason }); };
    const typedAnything = [row.boughtOn, row.packs, row.packSize, row.pricePerPack, row.brand, row.boughtAt, row.store].some((s) => clean(s) !== '');
    if (!lineNumber && !item && !typedAnything) continue;   // a blank row (Branch may be filled in for you)

    const packs = numberOf(row.packs);
    const size = numberOf(row.packSize);
    const price = numberOf(row.pricePerPack);
    const bought = dayOf(row.boughtOn);
    const brand = clean(row.brand) || null;
    // Blank keeps what Clerque has, the way a blank brand does.
    const where = sourceKindFromLabel(row.boughtAt);
    // Cut, then tidy, the way the app stores it: a cut on a space must not leave one behind.
    const store = cleanSourceName(cleanSourceName(row.store)?.slice(0, 80));
    if ([packs, size, price].some((n) => Number.isNaN(n))) { refuse('Packs, pack size and price have to be numbers.'); continue; }
    if (clean(row.boughtAt) && !where) { refuse(`Bought at has to be one of ${KIND_WORDS}.`); continue; }
    if (row.storeIsDate) { refuse('Excel turned the Store into a date. Type the store again with an apostrophe in front, like \'7-11.'); continue; }
    if (bought === 'bad') { refuse('Bought on has to be a date (YYYY-MM-DD).'); continue; }
    if (bought && bought > input.today) { refuse('Bought on is in the future.'); continue; }
    const filled = [packs, size, price].filter((n) => n != null).length;

    /** A FILL, once it has passed the checks every fill must pass. */
    const fill = (line: ExistingLine, next: {
      packsBought: number; packSize: number; packCost: number; brandNote: string | null; boughtOn: string | null;
      sourceKind: SourceKind | null; sourceName: string | null;
    }): void => {
      const first = claimed.get(line.lineId);
      if (first != null) { refuse(`${line.lineNumber} (${line.itemName}) is filled on row ${first} too. Keep one row per purchase.`); return; }
      if (next.boughtOn) {
        const agreed = requestDay.get(line.requestId);
        if (agreed && agreed.day !== next.boughtOn) {
          refuse(`${line.requestNumber} has Bought on ${agreed.day} on row ${agreed.row}. One bought-on date per request.`);
          return;
        }
        requestDay.set(line.requestId, { day: next.boughtOn, row: row.rowNumber });
      }
      claimed.set(line.lineId, row.rowNumber);
      out.push({ kind: 'FILL', rowNumber: row.rowNumber, lineNumber: line.lineNumber, item: line.itemName, unit: line.unit, lineId: line.lineId, requestId: line.requestId, ...next });
    };
    /** Why a line cannot take a change from the sheet, or null when it can. */
    const cannotChange = (line: ExistingLine): string | null => {
      if (line.receivedAt) return `${line.itemName} (${line.lineNumber}) is already in stock. Correct it under Stock on hand, not in the sheet.`;
      if (line.requestStatus === 'OPEN') return `${line.requestNumber} has not been sent yet. Send it, then record what was bought.`;
      if (line.requestStatus === 'CANCELLED') return `${line.requestNumber} was cancelled.`;
      if (line.requestStatus === 'RECEIVED') return `${line.requestNumber} is closed and ${line.itemName} went back on the list. Record it on the open list.`;
      if (line.prepaid) return `${line.requestNumber} was paid ahead, so a change there is a money correction. Change it on the request.`;
      return null;
    };

    // ── a line already on a request ────────────────────────────────────────
    if (lineNumber) {
      const firstRow = seenNumbers.get(key(lineNumber));
      if (firstRow != null) { refuse(`Line ${lineNumber} is on row ${firstRow} too. Keep one row per line.`); continue; }
      seenNumbers.set(key(lineNumber), row.rowNumber);

      const line = byNumber.get(key(lineNumber));
      if (!line) { refuse(`No line ${lineNumber} in this shop. Leave Line No. blank to add a purchase.`); continue; }
      if (filled > 0 && filled < 3 && !row.was) { refuse('Fill in packs, pack size and price per pack together.'); continue; }

      const typedSize = size == null ? null : inItemUnit(size, row.packUnit, line.unit);
      if (typeof typedSize === 'string') { refuse(typedSize); continue; }

      if (row.was) {
        /*
          Changed means changed in the FILE. An item renamed in Clerque since the
          download is not an edit; an item typed over in the grey cell is.
        */
        if (item && key(item) !== key(row.was.item)) {
          refuse(`The item on ${lineNumber} cannot be changed in the sheet. To buy something else, use an empty row.`);
          continue;
        }
        const wasPacks = numberOf(row.was.packs), wasSize = numberOf(row.was.packSize), wasPrice = numberOf(row.was.pricePerPack);
        const wasBrand = clean(row.was.brand) || null, wasDay = dayOf(row.was.boughtOn);
        // A file from before the store columns has nothing to compare them with, and nothing typed in them either.
        const hasWasSource = row.was.boughtAt !== undefined && row.was.store !== undefined;
        const wasWhere = hasWasSource ? sourceKindFromLabel(row.was.boughtAt) : null;
        const wasStore = hasWasSource ? cleanSourceName(row.was.store) : null;
        const edited = (packs != null && !same(packs, wasPacks)) || (typedSize != null && !same(typedSize, wasSize))
          || (price != null && !same(price, wasPrice)) || (brand != null && brand !== wasBrand)
          || (bought != null && bought !== wasDay)
          || (where != null && where !== wasWhere) || (store != null && store !== wasStore);
        if (!edited) { out.push({ kind: 'UNCHANGED', rowNumber: row.rowNumber, lineNumber, item: line.itemName }); continue; }
        // Edited in the file, and Clerque already says the same -- this file was uploaded before.
        const alreadyInClerque = (packs == null || same(packs, line.packsBought)) && (typedSize == null || same(typedSize, line.packSize))
          && (price == null || same(price, line.packCost)) && (brand == null || brand === line.brandNote) && (bought == null || bought === line.boughtOn)
          && (where == null || where === kindOf(line.sourceKind)) && (store == null || store === cleanSourceName(line.sourceName));
        if (alreadyInClerque) { out.push({ kind: 'UNCHANGED', rowNumber: row.rowNumber, lineNumber, item: line.itemName }); continue; }
        const drifted = !same(line.packsBought, wasPacks) || !same(line.packSize, wasSize) || !same(line.packCost, wasPrice)
          || (line.brandNote ?? null) !== wasBrand || (wasDay !== 'bad' && (line.boughtOn ?? null) !== wasDay)
          || (hasWasSource && (kindOf(line.sourceKind) !== wasWhere || cleanSourceName(line.sourceName) !== wasStore));
        if (drifted) {
          refuse(`${line.itemName} (${lineNumber}) was changed in Clerque after this file was downloaded. Download the file again and make the change there.`);
          continue;
        }
      } else {
        if (item && key(item) !== key(line.itemName)) {
          refuse(`Line ${lineNumber} is ${line.itemName}. To buy something else, use an empty row.`);
          continue;
        }
      }

      const next = {
        packsBought: packs ?? line.packsBought, packSize: typedSize ?? line.packSize, packCost: price ?? line.packCost,
        brandNote: brand ?? line.brandNote, boughtOn: bought,
        sourceKind: where ?? kindOf(line.sourceKind), sourceName: store ?? cleanSourceName(line.sourceName),
      };
      const sameBuy = same(next.packsBought, line.packsBought) && same(next.packSize, line.packSize)
        && same(next.packCost, line.packCost) && next.brandNote === line.brandNote && (bought == null || bought === line.boughtOn);
      const unchanged = sameBuy && next.sourceKind === kindOf(line.sourceKind) && next.sourceName === cleanSourceName(line.sourceName);
      if (unchanged) { out.push({ kind: 'UNCHANGED', rowNumber: row.rowNumber, lineNumber, item: line.itemName }); continue; }

      const why = cannotChange(line);
      if (why) {
        // Only where it was bought changed: "correct it under Stock on hand" would send them somewhere with no store to set.
        const whereOnly = sameBuy && (line.receivedAt || line.prepaid);
        refuse(whereOnly
          ? `Bought at and Store can only be filled in from the sheet before ${line.itemName} (${line.lineNumber}) is ${line.receivedAt ? 'in stock' : 'paid ahead'}; it stays as recorded.`
          : why);
        continue;
      }
      if (!(next.packsBought! > 0) || !(next.packSize! > 0) || !(next.packCost! > 0)) {
        refuse(filled < 3 && line.packsBought == null
          ? 'Fill in packs, pack size and price per pack together.'
          : 'Packs, pack size and price per pack all have to be more than zero.');
        continue;
      }
      fill(line, {
        packsBought: next.packsBought!, packSize: next.packSize!, packCost: next.packCost!, brandNote: next.brandNote, boughtOn: bought,
        sourceKind: next.sourceKind, sourceName: next.sourceName,
      });
      continue;
    }

    // ── a purchase that is on no request ───────────────────────────────────
    if (!item) { refuse('Which item? Pick one from the list in the Item column.'); continue; }
    if (!input.canAddNew) { refuse('Only the owner or a manager can add a purchase from the sheet. Leave it to them, or add it to a request.'); continue; }
    const rowKey = clean(row.rowKey) || null;
    if (rowKey) {
      const twin = seenKeys.get(rowKey);
      if (twin != null) { refuse(`This row was copied from row ${twin}. Use an empty row for another purchase.`); continue; }
      seenKeys.set(rowKey, row.rowNumber);
    }

    // Switched-off ingredients do not make an active one ambiguous.
    const active = input.materials.filter((m) => m.isActive);
    const exact = active.filter((m) => m.name === item);
    const loose = exact.length ? exact : active.filter((m) => key(m.name) === key(item));
    if (loose.length === 0) {
      const off = input.materials.find((m) => !m.isActive && key(m.name) === key(item));
      refuse(off ? `${off.name} is switched off in Clerque.` : `No ingredient called "${item}". Pick one from the list (the Items sheet), exactly as spelled.`);
      continue;
    }
    if (loose.length > 1) { refuse(`More than one ingredient is called "${item}" apart from capital letters. Rename one in Clerque first.`); continue; }
    const material = loose[0];
    if (material.isPrep) { refuse(`${material.name} is made in the kitchen, not bought. Record it on the prep board.`); continue; }

    const typedBranch = clean(row.branch);
    const branch = typedBranch
      ? input.branches.find((b) => key(b.name) === key(typedBranch))
      : input.branches.length === 1 ? input.branches[0] : undefined;
    if (!branch) { refuse(typedBranch ? `No branch called "${typedBranch}".` : 'Which branch? Fill in Branch.'); continue; }
    if (!bought) { refuse('When was it bought? Fill in Bought on (YYYY-MM-DD).'); continue; }
    if (filled < 3) { refuse('Fill in packs, pack size and price per pack.'); continue; }
    if (!(packs! > 0) || !(size! > 0) || !(price! > 0)) { refuse('Packs, pack size and price per pack all have to be more than zero.'); continue; }
    // A blank unit on a new purchase is where a 25 kg sack becomes 25 g.
    if (!clean(row.packUnit)) { refuse(`Pack unit: what is the pack size in (${material.unit}${UNIT_HINT[normUnit(material.unit)] ?? ''})?`); continue; }
    const sizeInUnit = inItemUnit(size!, row.packUnit, material.unit);
    if (typeof sizeInUnit === 'string') { refuse(sizeInUnit); continue; }

    /*
      Uploaded before? First by the row's own key: a date, branch or item fixed
      after recording is a change to that purchase, made in Clerque -- not a
      second purchase. Then, for a row without a key, by the same ingredient
      bought the same day at the same branch from a sheet.
    */
    const keyed = rowKey ? byRowKey.get(rowKey) : undefined;
    if (keyed && (keyed.branchId !== branch.id || keyed.boughtOn !== bought || keyed.rawMaterialId !== material.id)) {
      refuse(`Already recorded as ${keyed.lineNumber}: ${keyed.itemName} at ${keyed.branchName || branchName(keyed.branchId)}, bought ${keyed.boughtOn}. `
        + `To change the item, branch or date, cancel ${keyed.requestNumber} in Clerque, then upload again.`);
      continue;
    }
    const earlier = keyed ?? input.lines.find((l) => l.fromSheet && l.requestStatus !== 'CANCELLED'
      && l.branchId === branch.id && l.boughtOn === bought && l.rawMaterialId === material.id);
    if (earlier) {
      const nextKind = where ?? kindOf(earlier.sourceKind), nextStore = store ?? cleanSourceName(earlier.sourceName);
      const unchanged = same(packs, earlier.packsBought) && same(sizeInUnit, earlier.packSize) && same(price, earlier.packCost)
        && (brand ?? earlier.brandNote) === earlier.brandNote
        && nextKind === kindOf(earlier.sourceKind) && nextStore === cleanSourceName(earlier.sourceName);
      if (unchanged) { out.push({ kind: 'UNCHANGED', rowNumber: row.rowNumber, lineNumber: earlier.lineNumber, item: material.name }); continue; }
      const why = cannotChange(earlier);
      if (why) { refuse(`Already recorded as ${earlier.lineNumber}. ${why}`); continue; }
      fill(earlier, {
        packsBought: packs!, packSize: sizeInUnit, packCost: price!, brandNote: brand ?? earlier.brandNote, boughtOn: null,
        sourceKind: nextKind, sourceName: nextStore,
      });
      continue;
    }

    // One row per ingredient per branch per day: a request holds each ingredient once.
    const groupKey = `${branch.id}|${bought}|${material.id}`;
    const twin = seenNew.get(groupKey);
    if (twin != null) { refuse(`${material.name} bought on ${bought} is on row ${twin} too. Put both on one row (add up the packs).`); continue; }
    seenNew.set(groupKey, row.rowNumber);
    out.push({
      kind: 'NEW', rowNumber: row.rowNumber, item: material.name, unit: material.unit, branchId: branch.id, branchName: branch.name, rawMaterialId: material.id,
      boughtOn: bought, packsBought: packs!, packSize: sizeInUnit, packCost: price!, brandNote: brand, rowKey,
      sourceKind: where, sourceName: store,
    });
  }
  return out;
}
