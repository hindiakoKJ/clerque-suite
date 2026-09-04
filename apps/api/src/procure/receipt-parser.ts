import { normUnit, unitFactor } from '../inventory/unit-conversion';

/**
 * Reading a grocery receipt into the shop's own ingredient list.
 *
 * Two halves, kept apart on purpose. The model reads the photo and returns
 * what is PRINTED: a description, a quantity, a unit, a price. Everything
 * after that -- which ingredient a printed line IS, how a kilo on the receipt
 * becomes grams on the shelf, whether a line is stock or an expense -- is
 * decided here, in plain code, against the tenant's own data. The model never
 * sees the ingredient list and never picks an id: a hallucinated match would
 * post stock to the wrong ingredient with nothing on the page to show it, and
 * the matching is the part that has to be testable without an API key.
 *
 * Nothing in this file touches the database or the network.
 */

export const RECEIPT_LINES_SYSTEM_PROMPT = `You read Philippine grocery, market and supplier receipts for a small cafe's stock system.

Given a photo of ONE receipt, return every purchased line as printed, plus the header.

For each line:
  - description   the item text as printed (keep brand words; do not translate)
  - quantity      how many units were bought, as a number. A weighed item prints its weight here (5.810 for "5.810 KG")
  - unit          the unit the quantity is in, as printed: kg, g, L, ml, pc, pcs, pack, bottle, can, box, sachet, tray, or null if none is printed
  - unitPrice     the price of ONE unit as printed, numeric, no currency symbol; null if not printed
  - lineTotal     the line's total as printed, numeric; null if not printed
  - kind          "ingredient" for food and drink ingredients, "supply" for cleaning, packaging and kitchen consumables that are stocked (bleach, tissue, cups, gloves), "expense" for anything that is not stock at all (a delivery fee, a service charge, parking, a repair)
  - expenseCategory  only for kind "expense": one of RENT, UTILITIES, SUPPLIES, REPAIRS, TRANSPORT, OTHER
  - confidence    0-1, your confidence that description, quantity and price were read correctly

Header:
  - vendor          the store or supplier name as printed, or null
  - dateText        the date as printed, or null
  - dateIso         that date as YYYY-MM-DD when you can read it unambiguously, else null. Philippine receipts print month first (MM/DD/YYYY); if the format is ambiguous return null
  - referenceNumber the receipt / invoice / OR number as printed, or null
  - total           the FINAL total paid, numeric, or null

Rules:
  - A size printed inside the description (1KG, 500G, 1.5L, 12OZ) is the PACK SIZE, not the quantity. If the receipt prints a count, quantity is that count and unit is pc, pack or bottle. Only a weighed line -- a weight with a per-kilo price -- puts the weight in quantity with unit kg.
  - Most till receipts print ONE money figure per line: that is lineTotal. Fill unitPrice only when a separate per-unit price is printed; never copy the line total into it.
  - One object per purchased line. Skip subtotal, VAT, change, cash tendered and discount summary rows.
  - Never invent a line. If a line is unreadable, include it with the description you can read and null for the rest, with low confidence.
  - Numbers are plain numerics: 1132.95 not "1,132.95" or "P1132.95".
  - Return ONLY valid JSON, no prose:
{
  "vendor": <string|null>,
  "dateText": <string|null>,
  "dateIso": <string|null>,
  "referenceNumber": <string|null>,
  "total": <number|null>,
  "lines": [
    { "description": <string>, "quantity": <number|null>, "unit": <string|null>,
      "unitPrice": <number|null>, "lineTotal": <number|null>,
      "kind": <"ingredient"|"supply"|"expense">, "expenseCategory": <string|null>,
      "confidence": <0-1> }
  ]
}`;

export type LineKind = 'ingredient' | 'supply' | 'expense';
export const EXPENSE_CATEGORIES = ['RENT', 'UTILITIES', 'SUPPLIES', 'REPAIRS', 'TRANSPORT', 'OTHER'] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export interface ParsedLine {
  description:      string;
  quantity:         number | null;
  unit:             string | null;
  unitPrice:        number | null;
  lineTotal:        number | null;
  kind:             LineKind;
  expenseCategory:  ExpenseCategory | null;
  confidence:       number;
}

export interface ParsedReceipt {
  vendor:          string | null;
  dateText:        string | null;
  dateIso:         string | null;
  referenceNumber: string | null;
  total:           number | null;
  lines:           ParsedLine[];
}

/** "1,132.95", "P1132.95", "₱ 1 132.95" -> 1132.95. Anything else -> null. */
export function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const cleaned = v.replace(/[₱pP]/g, '').replace(/[,\s]/g, '').trim();
  if (!cleaned || !/^-?\d*\.?\d+$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Turn the model's text into a receipt, salvaging the first {...} block if it
 * wrapped the JSON in prose. Shape is enforced here so nothing downstream has
 * to defend against a missing array or a quoted number.
 */
export function parseReceiptJson(text: string): ParsedReceipt {
  let raw: unknown;
  try {
    const m = text.match(/\{[\s\S]*\}/);
    raw = JSON.parse(m ? m[0] : text);
  } catch {
    throw new Error('The receipt could not be read. Try a sharper, flatter photo with the whole receipt in frame.');
  }
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown): string | null =>
    typeof v === 'string' && v.trim() ? v.trim() : null;

  const linesRaw = Array.isArray(o.lines) ? o.lines : [];
  const lines: ParsedLine[] = [];
  for (const l of linesRaw) {
    if (!l || typeof l !== 'object') continue;
    const r = l as Record<string, unknown>;
    const description = str(r.description);
    if (!description) continue;
    const kindRaw = String(r.kind ?? '').toLowerCase();
    const kind: LineKind = kindRaw === 'expense' ? 'expense' : kindRaw === 'supply' ? 'supply' : 'ingredient';
    const catRaw = String(r.expenseCategory ?? '').toUpperCase();
    const expenseCategory = (EXPENSE_CATEGORIES as readonly string[]).includes(catRaw)
      ? (catRaw as ExpenseCategory) : null;
    const conf = toNumber(r.confidence);
    lines.push({
      description,
      quantity:        toNumber(r.quantity),
      unit:            str(r.unit),
      unitPrice:       toNumber(r.unitPrice),
      lineTotal:       toNumber(r.lineTotal),
      kind,
      expenseCategory: kind === 'expense' ? (expenseCategory ?? 'OTHER') : null,
      confidence:      conf == null ? 0 : Math.max(0, Math.min(1, conf)),
    });
  }

  const dateIso = str(o.dateIso);
  return {
    vendor:          str(o.vendor),
    dateText:        str(o.dateText),
    dateIso:         dateIso && ISO_DATE.test(dateIso) ? dateIso : null,
    referenceNumber: str(o.referenceNumber),
    total:           toNumber(o.total),
    lines,
  };
}

// ── matching a printed line to an ingredient ────────────────────────────────

/** Tokens that describe packaging or quantity, not the thing itself. */
const NOISE = new Set([
  'kg', 'kgs', 'g', 'gm', 'gms', 'grams', 'gram', 'l', 'ltr', 'liter', 'litre', 'ml',
  'pc', 'pcs', 'piece', 'pieces', 'pk', 'pack', 'packs', 'btl', 'bottle', 'bottles',
  'can', 'cans', 'box', 'boxes', 'sachet', 'sachets', 'tray', 'trays', 'bag', 'bags',
  'x', 'per', 'of', 'the', 'and', '&', 'w', 'with', 'net', 'wt', 'approx',
]);

/** Lowercase, punctuation out, one space between words. */
export function normalizeName(s: string): string {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The words that carry meaning, singularised crudely (wings -> wing) so a
 * receipt's "CHICKEN WINGS" meets the shop's "Chicken wing" and vice versa.
 * Numbers go: "300ml" and "1kg" say how much, not what.
 */
export function tokens(s: string): string[] {
  return normalizeName(s)
    .split(' ')
    .map((t) => t.replace(/^\d+(\.\d+)?/, ''))     // "300ml" -> "ml", "2x" -> "x"
    .filter((t) => t.length > 0 && !/^\d/.test(t) && !NOISE.has(t))
    .map((t) => (t.length > 3 && t.endsWith('s') && !t.endsWith('ss') ? t.slice(0, -1) : t));
}

/**
 * Two tokens agree when equal, or when one is the other plus an inflection.
 *
 * The prefix allowance exists for wing/wings and chili/chilies. It must NOT
 * reach composition: "straw" is a prefix of "strawberry", "water" of
 * "watermelon", "corn" of "cornstarch", "cream" of "cream dory", and each of
 * those posts a market line onto the wrong shelf at full confidence. Two
 * letters is an ending; anything longer is a different word.
 */
function tokenMatches(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length < 4) return false;
  if (long.length - short.length > 2) return false;
  return long.startsWith(short);
}

/**
 * 0..1. Exact name is 1. Every word of the ingredient's name appearing in the
 * receipt line is at least 0.85 -- "MAGNOLIA FRESH MILK 1L" contains all of
 * "Fresh Milk". Otherwise the share of words the two have in common.
 */
export function scoreMatch(description: string, name: string): number {
  const nd = normalizeName(description);
  const nn = normalizeName(name);
  if (!nd || !nn) return 0;
  if (nd === nn) return 1;

  const td = tokens(description);
  const tn = tokens(name);
  if (td.length === 0 || tn.length === 0) return 0;

  const hit = (t: string, list: string[]) => list.some((x) => tokenMatches(t, x));
  const nameCovered = tn.every((t) => hit(t, td));
  const common = tn.filter((t) => hit(t, td)).length;
  const union = new Set([...td, ...tn]).size;
  const jaccard = union === 0 ? 0 : common / union;

  /*
    "Every word of the name appears in the line" is strong evidence for a
    two-word name and weak for a one-word one: "Cream" appears in "CREAM DORY
    500G", and that is a fish. A single word earns the bonus only when it is
    the thing the line is about -- the last word, where English and Filipino
    receipts both put the noun ("BROWN SUGAR", "SALTED EGG", "CREAM DORY").
  */
  if (nameCovered) {
    if (tn.length >= 2) return Math.max(0.85, jaccard);
    if (td.length > 0 && tokenMatches(tn[0], td[td.length - 1])) return Math.max(0.85, jaccard);
  }
  return jaccard;
}

export interface MaterialRef {
  id:        string;
  name:      string;
  unit:      string;
  category:  string;
  costPrice: number | null;
}

export interface Candidate { material: MaterialRef; score: number }
export interface MatchResult { best: Candidate | null; alternatives: Candidate[] }

/**
 * At or below this the sheet asks rather than guesses.
 *
 * Strict, not inclusive: exactly 0.5 is one shared word out of two -- "CREAM
 * DORY" against "Cream", "GARLIC POWDER" against "Garlic" -- and that is a
 * coin flip dressed as a match. A covered name scores 0.85; a real partial
 * overlap of a longer name scores above a half. Half itself is a question.
 */
export const MATCH_THRESHOLD = 0.5;

export function matchIngredient(description: string, materials: MaterialRef[]): MatchResult {
  const scored = materials
    .map((m) => ({ material: m, score: scoreMatch(description, m.name) }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score || a.material.name.localeCompare(b.material.name));
  /*
    A tie at the top is a question, not an answer. Two candidates at the same
    score were separated by nothing but alphabetical order, and a preselected
    "Fresh Milk" over "Fresh Milk (Lactose Free)" at the same 0.85 posts to
    whichever sorted first. Offer both; let the person choose.
  */
  const tied = scored.length >= 2 && Math.abs(scored[0].score - scored[1].score) < 1e-9;
  const best = scored.length && scored[0].score > MATCH_THRESHOLD && !tied ? scored[0] : null;
  const alternatives = scored.filter((c) => c !== best).slice(0, 4);
  return { best, alternatives };
}

// ── from a printed line to packs on the shelf ───────────────────────────────

/** Units a shop buys by the container, where "one" is a whole thing. */
const COUNTABLE = new Set(['pc', 'pcs', 'piece', 'pack', 'bottle', 'can', 'box', 'sachet', 'tray', 'bag', 'roll']);

const money = (n: number) => 'P' + n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 4 });

export interface PackSuggestion {
  packsBought:   number | null;
  /** How many of the ingredient's unit one printed unit holds. Null = ask. */
  packSize:      number | null;
  packCost:      number | null;
  needsPackSize: boolean;
  note:          string | null;
}

/**
 * The receipt says "5.810 KG @ 195"; the shelf counts grams. Bridge the two
 * the way the importer does -- arithmetic where the units are the same kind,
 * a question where they are not -- and never a guess at density.
 */
export function derivePack(line: ParsedLine, material: MaterialRef): PackSuggestion {
  const printedUnit = line.unit ? normUnit(line.unit) : '';
  const shelfUnit   = normUnit(material.unit);

  /*
    A price read as 0 is a price not read. The reader returns 0 for an
    unreadable figure often enough, and a zero that reaches the shelf is not
    harmless: it skips the order-of-magnitude guard (which needs a positive
    cost) yet still blends into the weighted average, so a kilo of sugar "at
    nothing" quietly lowers what every recipe using sugar costs. Unknown is
    unknown; the screen asks.
  */
  const unitPrice = line.unitPrice != null && line.unitPrice > 0 ? line.unitPrice : null;
  const lineTotal = line.lineTotal != null && line.lineTotal > 0 ? line.lineTotal : null;

  let packsBought = line.quantity != null && line.quantity > 0 ? line.quantity : null;
  if (packsBought == null && lineTotal != null && unitPrice != null) {
    packsBought = +(lineTotal / unitPrice).toFixed(4);
  }
  if (packsBought == null && lineTotal != null) packsBought = 1;

  let packCost = unitPrice;
  if (packCost == null && lineTotal != null && packsBought != null && packsBought > 0) {
    packCost = +(lineTotal / packsBought).toFixed(4);
  }

  let packSize: number | null = null;
  let note: string | null = null;

  /*
    When the three printed figures disagree, the line total wins.

    A till receipt prints one money column, and the reader sometimes puts that
    figure in unitPrice as well. 5.81 kg "at" P1,132.95 is P6,582 of chicken
    for a P1,132.95 line; the total is the number the person paid, so the
    per-unit price is what the total says it is, and the screen is told why.
  */
  if (packsBought != null && packsBought > 0 && unitPrice != null && lineTotal != null) {
    const implied = packsBought * unitPrice;
    if (Math.abs(implied - lineTotal) > Math.max(1, lineTotal * 0.01)) {
      packCost = +(lineTotal / packsBought).toFixed(4);
      note = `The line total says ${money(packCost)} each, not ${money(unitPrice)}; the total was used.`;
    }
  }

  if (printedUnit && printedUnit === shelfUnit) {
    packSize = 1;
  } else if (printedUnit) {
    const f = unitFactor(printedUnit, shelfUnit);
    if (f != null) {
      // Four places: the DTO refuses more, and 28.349523125 g in an ounce is
      // not a number anyone types back in.
      packSize = +f.toFixed(4);
      note = [note, `${line.unit} on the receipt, ${material.unit} on the shelf: 1 ${line.unit} = ${packSize} ${material.unit}.`]
        .filter(Boolean).join(' ');
    } else {
      note = `The receipt says ${line.unit} but ${material.name} is counted in ${material.unit}. How many ${material.unit} is one ${line.unit}?`;
    }
  } else if (COUNTABLE.has(shelfUnit)) {
    // No unit printed and the shelf counts whole things: one line item is one thing.
    packSize = 1;
  } else {
    note = `No unit on the receipt. How many ${material.unit} of ${material.name} did one item hold?`;
  }

  return {
    packsBought,
    packSize,
    packCost,
    needsPackSize: packSize == null,
    note,
  };
}
