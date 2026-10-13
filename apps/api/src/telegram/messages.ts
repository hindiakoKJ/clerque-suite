import { PH_TIMEZONE } from '@repo/shared-types';

/**
 * What the alerts say. Pure functions over plain data, so every message can
 * be checked in a test without Telegram.
 *
 * Telegram HTML mode is used instead of MarkdownV2: only & < > need escaping,
 * so a product called "Mocha (Large) - 16oz" cannot turn into a message
 * Telegram refuses with a 400 and silently never delivers -- the lesson the
 * Trade Bot learned the hard way. Every value from the database goes through
 * escapeHtml, and text is cut to length BEFORE it is escaped, never after, so
 * a cut can never land inside an entity.
 *
 * A sale is laid out like a receipt in a monospace block 32 characters wide,
 * which fits a phone without wrapping. It says plainly that it is an alert,
 * not an official receipt, and never carries a PWD/senior ID, a customer's
 * name, TIN or address.
 */

export const MESSAGE_LIMIT = 4096;
export const CAPTION_LIMIT = 1024;
const WIDTH = 32;
const RULE = '-'.repeat(WIDTH);

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function money(n: number): string {
  return n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function qty(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10000) / 10000);
}

export function manilaTime(d: Date): string {
  return new Intl.DateTimeFormat('en-PH', {
    timeZone: PH_TIMEZONE, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(d);
}

function clip(s: string, max: number): string {
  const chars = [...s];
  return chars.length <= max ? s : chars.slice(0, Math.max(1, max - 1)).join('') + '…';
}

/** Left text and a right-aligned amount on one 32-character line. */
function row(left: string, right: string): string {
  const room = WIDTH - [...right].length - 1;
  const l = clip(left, Math.max(4, room));
  return l + ' '.repeat(Math.max(1, WIDTH - [...l].length - [...right].length)) + right;
}

function place(shop: string, branch: string | null): string {
  return escapeHtml(branch ? `${shop} · ${branch}` : shop);
}

/** One word per PaymentMethod in the schema. A method added there later shows as its raw name until it gets a word here. */
const PAYMENT_WORDS: Record<string, string> = {
  CASH: 'Cash',
  GCASH_PERSONAL: 'GCash',
  GCASH_BUSINESS: 'GCash',
  MAYA_PERSONAL: 'Maya',
  MAYA_BUSINESS: 'Maya',
  QR_PH: 'QR Ph',
  CARD: 'Card',
};

function paymentWord(method: string): string {
  return PAYMENT_WORDS[method] ?? method;
}

/**
 * How the sale was paid, for the headline: "GCash", or "Cash + GCash" for a
 * split. Each way of paying is named once, in the order it was taken.
 */
export function paidWith(payments: Array<{ method: string }>): string {
  return [...new Set(payments.map((p) => paymentWord(p.method)))].join(' + ');
}

/** The reference the cashier typed, on one line; nothing for cash or when none was typed. */
function paymentRef(p: { method: string; reference?: string | null }): string {
  if (p.method === 'CASH') return '';
  return (p.reference ?? '').replace(/\s+/g, ' ').trim();
}

const DISCOUNT_WORDS: Record<string, string> = {
  PWD: 'PWD discount',
  SENIOR_CITIZEN: 'Senior discount',
  PROMO: 'Promo',
  CASHIER_APPLIED: 'Discount',
  MANAGER_OVERRIDE: 'Discount',
};

/**
 * Builds a message from a list of item blocks, dropping items from the end
 * until the whole thing fits, and saying how many were left out.
 */
function fitItems(build: (blocks: string[], more: number) => string, blocks: string[], limit: number): string {
  for (let shown = blocks.length; shown >= 0; shown--) {
    const text = build(blocks.slice(0, shown), blocks.length - shown);
    if (text.length <= limit) return text;
  }
  return build([], blocks.length).slice(0, limit);
}

// ── sale ───────────────────────────────────────────────────────────────────

export interface SaleForAlert {
  shopName: string;
  branchName: string | null;
  orderNumber: string;
  cashierName: string | null;
  channel: string;
  /** When the till says it was rung up (device clock for an offline sale). */
  paidAt: Date | null;
  /** When the server received it. */
  createdAt: Date;
  subtotal: number;
  discountAmount: number;
  vatAmount: number;
  totalAmount: number;
  items: Array<{ name: string; quantity: number; unitPrice: number; lineTotal: number; modifiers: Array<{ name: string; price: number }> }>;
  /** `reference`: what the cashier typed for a GCash, Maya, QR Ph or card payment. */
  payments: Array<{ method: string; amount: number; reference?: string | null }>;
  discountTypes: string[];
}

/**
 * One payment on the receipt: "GCash #1234567" and the amount. A reference
 * too long to share the line goes whole on the line under it -- the last
 * digits are the ones the owner matches against the GCash app, so it is
 * never cut short with the amount beside it.
 */
function paymentLines(p: { method: string; amount: number; reference?: string | null }): string[] {
  const word = paymentWord(p.method);
  const ref = paymentRef(p);
  const amount = money(p.amount);
  if (!ref) return [row(word, amount)];
  const oneLine = `${word} #${ref}`;
  if ([...oneLine].length <= WIDTH - [...amount].length - 1) return [row(oneLine, amount)];
  return [row(word, amount), clip(`  #${ref}`, WIDTH)];
}

export function saleMessage(sale: SaleForAlert): string {
  const rungAt = sale.paidAt ?? sale.createdAt;
  const late = sale.paidAt != null && sale.createdAt.getTime() - sale.paidAt.getTime() > 5 * 60_000;

  const blocks = sale.items.map((it) => {
    const lines = [clip(it.name, WIDTH), row(`  ${qty(it.quantity)} × ${money(it.unitPrice)}`, money(it.lineTotal))];
    for (const m of it.modifiers) {
      lines.push(clip(`  + ${m.name}${m.price > 0 ? ` (+${money(m.price)})` : ''}`, WIDTH));
    }
    return lines.join('\n');
  });

  const build = (shown: string[], more: number) => {
    const body: string[] = [];
    body.push(clip(`${manilaTime(rungAt)}${sale.cashierName ? `  ${sale.cashierName}` : ''}`, WIDTH));
    body.push(RULE);
    body.push(...shown);
    if (more > 0) body.push(`…and ${more} more item${more === 1 ? '' : 's'}`);
    body.push(RULE);
    body.push(row('Subtotal', money(sale.subtotal)));
    if (sale.discountAmount > 0.004) {
      const words = [...new Set(sale.discountTypes.map((t) => DISCOUNT_WORDS[t] ?? 'Discount'))];
      body.push(row(words.length ? words.join(', ') : 'Discount', `-${money(sale.discountAmount)}`));
    }
    body.push(row('TOTAL', `₱${money(sale.totalAmount)}`));
    if (sale.vatAmount > 0.004) body.push(row('VAT included', money(sale.vatAmount)));
    for (const p of sale.payments) body.push(...paymentLines(p));

    // How it was paid sits in the headline, in bold: it is the first thing the owner looks for.
    const paid = paidWith(sale.payments);
    const head = [
      `🧾 <b>Sale ${escapeHtml(sale.orderNumber)}</b>  ₱${money(sale.totalAmount)}${paid ? ` - <b>${escapeHtml(paid)}</b>` : ''}`,
      place(sale.shopName, sale.branchName),
    ];
    if (sale.channel !== 'POS') head.push(escapeHtml(`Came in through ${sale.channel}`));
    if (late) head.push(escapeHtml(`Rung up offline · reached Clerque ${manilaTime(sale.createdAt)}`));
    return `${head.join('\n')}\n<pre>${escapeHtml(body.join('\n'))}</pre>\n<i>Sale alert, not an official receipt.</i>`;
  };
  return fitItems(build, blocks, MESSAGE_LIMIT);
}

export interface PriceAlert {
  shopName:    string;
  branchName:  string | null;
  orderNumber: string;
  cashierName: string | null;
  rungAt:      Date;
  /** Rung up offline and synced late: the till may simply have had an old price. */
  late:        boolean;
  flags: { productName: string; quantity: number; soldAt: number; menuPrice: number; why: 'BELOW_MENU' | 'DISCOUNT_WITHOUT_PROMO' }[];
}

/** A sale whose lines came in under the owner's prices (orders/price-check.ts). */
export function priceBelowMenuMessage(a: PriceAlert): string {
  const body: string[] = [clip(`${manilaTime(a.rungAt)}${a.cashierName ? `  ${a.cashierName}` : ''}`, WIDTH), RULE];
  for (const f of a.flags) {
    body.push(clip(f.productName, WIDTH));
    body.push(row(`  ${qty(f.quantity)} x sold at`, money(f.soldAt)));
    body.push(row(f.why === 'BELOW_MENU' ? '  menu price' : '  promo allows', money(f.menuPrice)));
  }
  const note = a.late
    ? 'Rung up offline: the till may have had an old price. If not, check this sale with the cashier.'
    : 'The till sent a price lower than your menu. Check this sale with the cashier.';
  const head = [`⚠️ <b>Sold below menu: ${escapeHtml(a.orderNumber)}</b>`, place(a.shopName, a.branchName)];
  return `${head.join('\n')}\n<pre>${escapeHtml(body.join('\n'))}</pre>\n<i>${escapeHtml(note)}</i>`;
}

// ── owner notice ───────────────────────────────────────────────────────────

export interface OwnerNoticeForAlert {
  shopName:   string;
  branchName: string | null;
  /** One line, in plain words: "Parts missing at the roll call". */
  title:      string;
  /** What to look at, one thing per line. */
  lines:      string[];
  at:         Date;
}

/**
 * Something the owner should look at that is not a sale or a purchase: parts
 * missing at a roll call, a part returned that was never sold. A bold title,
 * the shop, the time, and the lines in a monospace block; lines that do not
 * fit are counted in "…and N more".
 */
export function ownerNoticeMessage(n: OwnerNoticeForAlert): string {
  const title = String(n.title ?? '').replace(/\s+/g, ' ').trim() || 'Notice';
  const blocks = (n.lines ?? []).map((l) => clip(String(l ?? ''), 300));
  const build = (shown: string[], more: number) => {
    const body = [...shown];
    if (more > 0) body.push(`…and ${more} more`);
    const head = [
      `⚠️ <b>${escapeHtml(clip(title, 200))}</b>`,
      place(clip(n.shopName, 120), n.branchName ? clip(n.branchName, 80) : null),
      escapeHtml(manilaTime(n.at)),
    ];
    // No empty block: Telegram shows an empty <pre> as a blank box.
    return body.length > 0 ? `${head.join('\n')}\n<pre>${escapeHtml(body.join('\n'))}</pre>` : head.join('\n');
  };
  return fitItems(build, blocks, MESSAGE_LIMIT);
}

// ── buying ─────────────────────────────────────────────────────────────────

export interface RequestForAlert {
  shopName: string;
  branchName: string | null;
  requestNumber: string;
  lines: Array<{
    name: string; unit: string; packsBought: number | null; packSize: number | null; packCost: number | null; received: boolean;
    /** Priced from last time by the server (staff recorded packs only): for the owner to check against the receipt. */
    lastPrice?: boolean;
  }>;
}

/*
  Every line recorded as bought, priced or not. Staff on a shop that hides
  purchase costs record packs only; the price is last time's, or -- the first
  time an item is bought -- none yet. Dropping the unpriced ones made a first
  staff buy read "Bought: ₱0.00" over an empty list, to the one person who
  has to add the price.
*/
function boughtLines(req: RequestForAlert) {
  return req.lines.filter((l) => l.packsBought != null);
}

function boughtTotal(req: RequestForAlert): number {
  return boughtLines(req).reduce((t, l) => t + (l.packsBought ?? 0) * (l.packCost ?? 0), 0);
}

/** Bought lines with no price yet, and lines carrying last time's price. */
function priceGaps(req: RequestForAlert): { toAdd: number; lastTime: number } {
  const lines = boughtLines(req);
  return {
    toAdd:    lines.filter((l) => l.packCost == null).length,
    lastTime: lines.filter((l) => l.packCost != null && l.lastPrice).length,
  };
}

/**
 * What the owner still has to do about prices, in words; empty when nothing.
 * `marked`: the lines above carry a * on last time's prices, so the note
 * explains the mark; a photo caption has no lines, so it counts them.
 */
function priceGapWords(req: RequestForAlert, marked: boolean): string[] {
  const { toAdd, lastTime } = priceGaps(req);
  const items = (n: number) => `${n} item${n === 1 ? '' : 's'}`;
  const out: string[] = [];
  if (toAdd > 0) out.push(`${items(toAdd)} still need${toAdd === 1 ? 's' : ''} the price from the receipt.`);
  if (lastTime > 0) {
    out.push(marked
      ? `* Last time's price. Check ${lastTime === 1 ? 'it' : 'them'} against the receipt.`
      : `${items(lastTime)} at last time's price. Check against the receipt.`);
  }
  return out;
}

function packWords(l: { unit: string; packsBought: number | null; packSize: number | null }): string {
  const n = l.packsBought ?? 0;
  const size = l.packSize ?? 0;
  return `${qty(n)} pack${n === 1 ? '' : 's'} × ${qty(size)} ${l.unit}`;
}

export function buyListSentMessage(
  req: { shopName: string; branchName: string | null; requestNumber: string },
  lines: Array<{ name: string; amount: string }>,
  sentBy: string | null,
  at: Date,
): string {
  const blocks = lines.map((l) => `• ${escapeHtml(clip(l.name, 80))}: ${escapeHtml(clip(l.amount, 80))}`);
  const build = (shown: string[], more: number) => [
    `🛒 <b>Buy list ${escapeHtml(req.requestNumber)} sent</b>`,
    place(req.shopName, req.branchName),
    escapeHtml(`${sentBy ? `Sent by ${sentBy} · ` : ''}${manilaTime(at)}`),
    '',
    ...(lines.length === 0 ? ['Nothing hit its reorder level. All clear.'] : shown),
    ...(more > 0 ? [`…and ${more} more`] : []),
  ].join('\n');
  return fitItems(build, blocks, MESSAGE_LIMIT);
}

/**
 * A list already sent, added to from a kitchen or bar screen. Only the lines
 * that changed: a raised line's amount carries "(was ...)", so the owner can
 * tell a new item from a bigger one without opening the list.
 */
export function buyListUpdatedMessage(
  req: { shopName: string; branchName: string | null; requestNumber: string },
  lines: Array<{ name: string; amount: string }>,
  addedBy: string | null,
  at: Date,
): string {
  // The amount is longer than on a sent list ("3 packs (3,000 g) (was 2 packs (2,000 g))"), so it is cut later.
  const blocks = lines.map((l) => `• ${escapeHtml(clip(l.name, 80))}: ${escapeHtml(clip(l.amount, 120))}`);
  const build = (shown: string[], more: number) => [
    `🛒 <b>Buy list ${escapeHtml(req.requestNumber)} updated</b>`,
    place(req.shopName, req.branchName),
    escapeHtml(`${addedBy ? `Added by ${addedBy} · ` : ''}${manilaTime(at)}`),
    '',
    ...shown,
    ...(more > 0 ? [`…and ${more} more`] : []),
  ].join('\n');
  return fitItems(build, blocks, MESSAGE_LIMIT);
}

export function boughtMessage(req: RequestForAlert, recordedBy: string | null, at: Date, added: { items: number; value: number } | null = null): string {
  const lines = boughtLines(req);
  const blocks = lines.map((l) => [
    clip(l.name, WIDTH),
    row(
      `  ${packWords(l)}`,
      l.packCost == null ? 'price to add' : `${money((l.packsBought ?? 0) * l.packCost)}${l.lastPrice ? '*' : ''}`,
    ),
  ].join('\n'));
  // "so far" whenever a line has no price yet: the total is not the bill.
  const soFar = priceGaps(req).toAdd > 0 ? ' so far' : '';
  const build = (shown: string[], more: number) => {
    const body = [...shown];
    if (more > 0) body.push(`…and ${more} more`);
    body.push(RULE, row(`TOTAL${soFar}`, `₱${money(boughtTotal(req))}`));
    return [
      added
        ? `✅ <b>Bought more: ${escapeHtml(req.requestNumber)}</b>  +₱${money(added.value)}`
        : `✅ <b>Bought: ${escapeHtml(req.requestNumber)}</b>  ₱${money(boughtTotal(req))}${soFar}`,
      place(req.shopName, req.branchName),
      escapeHtml(`${recordedBy ? `Recorded by ${recordedBy} · ` : ''}${manilaTime(at)}`),
      ...(added ? [escapeHtml(`Added now: ${added.items} item${added.items === 1 ? '' : 's'}, ₱${money(added.value)}. Request total ₱${money(boughtTotal(req))}${soFar}.`)] : []),
      `<pre>${escapeHtml(body.join('\n'))}</pre>`,
      ...priceGapWords(req, true).map(escapeHtml),
    ].join('\n');
  };
  return fitItems(build, blocks, MESSAGE_LIMIT);
}

export function photoCaption(req: RequestForAlert, label: string, filedBy: string | null, at: Date): string {
  const items = boughtLines(req).length;
  const text = [
    `📷 <b>${escapeHtml(clip(label, 40))} photo: ${escapeHtml(req.requestNumber)}</b>`,
    place(clip(req.shopName, 120), req.branchName ? clip(req.branchName, 80) : null),
    escapeHtml(`${filedBy ? `Filed by ${clip(filedBy, 80)} · ` : ''}${manilaTime(at)}`),
    items > 0 ? escapeHtml(`Bought on this request: ₱${money(boughtTotal(req))}${priceGaps(req).toAdd > 0 ? ' so far' : ''} (${items} item${items === 1 ? '' : 's'})`) : 'Nothing recorded as bought on this request yet.',
    ...(items > 0 ? priceGapWords(req, false).map(escapeHtml) : []),
  ].join('\n');
  return text.length <= CAPTION_LIMIT ? text : text.slice(0, text.lastIndexOf('\n', CAPTION_LIMIT));
}

export function postedMessage(req: RequestForAlert, postedBy: string | null, at: Date): string {
  const received = req.lines.filter((l) => l.received);
  const value = received.reduce((t, l) => t + (l.packsBought ?? 0) * (l.packCost ?? 0), 0);
  const blocks = received.map((l) => `• ${escapeHtml(clip(l.name, 80))}: ${escapeHtml(packWords(l))}`);
  const build = (shown: string[], more: number) => [
    `📦 <b>In stock: ${escapeHtml(req.requestNumber)}</b>  ₱${money(value)}`,
    place(req.shopName, req.branchName),
    escapeHtml(`${postedBy ? `Posted by ${postedBy} · ` : ''}${manilaTime(at)}`),
    '',
    ...(received.length === 0 ? ['Closed with nothing put on the shelf.'] : shown),
    ...(more > 0 ? [`…and ${more} more`] : []),
  ].join('\n');
  return fitItems(build, blocks, MESSAGE_LIMIT);
}

// ── weekly count ───────────────────────────────────────────────────────────

export interface WeeklyCountForAlert {
  shopName: string;
  branchName: string | null;
  stationName: string;
  countNumber: string;
  /** The name typed on the tablet, or the logged-in person's. */
  countedBy: string;
  sentAt: Date;
  /** Every line answered the owner's "Ask for a recount". */
  recount: boolean;
  /** A full count that also answered a recount: those items. */
  recounted?: string[];
  /** Items on the station's sheet counted (here or, for a shared item, by the other station), of all of them. */
  counted: number;
  total: number;
  /** In the item's own unit. `book` is the book at the moment the item was counted. */
  lines: Array<{ name: string; unit: string; counted: number; book: number }>;
  notCounted: string[];
}

function countedWords(l: { counted: number; book: number; unit: string }): { tail: string; relative: number } {
  const d = Math.round((l.counted - l.book) * 1000) / 1000;
  if (Math.abs(d) < 0.001) return { tail: 'matches', relative: 0 };
  return {
    tail: `${d < 0 ? 'short' : 'over'} ${usageQty(Math.abs(d), l.unit)}`,
    relative: Math.abs(d) / Math.max(Math.abs(l.book), Math.abs(l.counted), 1),
  };
}

/**
 * A kitchen or bar screen sent its weekly count. It is a record: nothing has
 * moved, and the message says so and where to adjust the books. A recount
 * lists what was counted again; otherwise the lines that differ, the
 * furthest off (for its size) first.
 */
export function weeklyCountMessage(c: WeeklyCountForAlert): string {
  const worded = c.lines.map((l) => ({ l, w: countedWords(l) }));
  const differing = worded.filter((x) => x.w.relative > 0).length;
  const listed = (c.recount ? worded : worded.filter((x) => x.w.relative > 0)).sort((a, b) => b.w.relative - a.w.relative);
  const blocks = listed.map(({ l, w }) => `• ${escapeHtml(clip(
    `${l.name}: counted ${usageQty(l.counted, l.unit)}, book ${usageQty(l.book, l.unit)}, ${w.tail}`, 160))}`);
  // A recount holds only what the owner asked about: how many of those, not of the whole sheet.
  const summary = `${c.recount
    ? `${c.lines.length} item${c.lines.length === 1 ? '' : 's'} counted again.`
    : `${c.counted} of ${c.total} items counted.`} ${differing === 0
    ? `All ${c.lines.length} match the book.`
    : `${differing} differ${differing === 1 ? 's' : ''} from the book.`}`;
  const names = (label: string, all: string[]) => (all.length === 0
    ? []
    : [escapeHtml(`${label}: ${all.slice(0, 15).map((n) => clip(n, 40)).join(', ')}${
        all.length > 15 ? ` and ${all.length - 15} more` : ''}`)]);
  const notCounted = [...(c.recount ? [] : names('Recounted', c.recounted ?? [])), ...names('Not counted', c.notCounted)];
  const build = (shown: string[], more: number) => [
    `📝 <b>${c.recount ? 'Recount sent' : 'Weekly count sent'}: ${escapeHtml(clip(c.stationName, 40))}</b>`,
    place(clip(c.shopName, 120), c.branchName ? clip(c.branchName, 80) : null),
    escapeHtml(`Counted by ${clip(c.countedBy, 40)} (${clip(c.stationName, 40)} screen) · ${manilaTime(c.sentAt)}`),
    escapeHtml(summary),
    ...(shown.length > 0 ? ['', ...shown] : []),
    ...(more > 0 ? [`…and ${more} more`] : []),
    ...notCounted,
    '',
    escapeHtml(`Recorded. Nothing has moved. To make the book match the shelf, open Procure > Counts (${c.countNumber}) and tap Adjust the books to match.`),
  ].join('\n');
  return fitItems(build, blocks, MESSAGE_LIMIT);
}

// ── end of day ─────────────────────────────────────────────────────────────

/** How many ingredients the phone shows; the rest are counted in "+N more" and listed on the report page. */
export const USAGE_ROWS_SHOWN = 25;

export interface UsageForAlert {
  shopName: string;
  branchName: string | null;
  /** The business day, YYYY-MM-DD, Manila. */
  day: string;
  /** Most valuable first, as the report sorts them. */
  rows: Array<{ name: string; unit: string; costPrice: number; total: number; wasted: number; writtenOff: number }>;
  /** Pesos, at today's costs -- the same figure the report page shows. */
  totalValue: number;
  /** Units sold that day still waiting at a kitchen or bar screen: nothing is counted for them yet. */
  stillBeingMade: number;
  /** Sales rung up offline that reached Clerque after the sheet for their hours went out: on no sheet. */
  lateSales: number;
  /** The weekly count's sentence, when it has one to say (procure/weekly-count.ts weeklyCountNote). */
  countNote?: string | null;
}

/**
 * What the sheet says about sales on no sheet. The bell says it in the same
 * words, so the phone and the bell never tell two stories.
 */
export function lateSalesNote(n: number): string {
  return n === 1
    ? "1 sale rung up offline reached Clerque after its day's sheet went out. No sheet counts it; the report page does."
    : `${n} sales rung up offline reached Clerque after their day's sheet went out. No sheet counts them; the report page does.`;
}

/** "Wed, Sep 16" for a YYYY-MM-DD Manila day. Noon, so no timezone can tip it into the day before. */
export function manilaDayLabel(day: string): string {
  return new Intl.DateTimeFormat('en-PH', { timeZone: PH_TIMEZONE, weekday: 'short', month: 'short', day: 'numeric' })
    .format(new Date(`${day}T12:00:00+08:00`));
}

/**
 * A quantity the way staff write it on the daily sheet: 8,100 ml is "8.1 L",
 * 1,250 g is "1.25 kg". Only grams and millilitres are scaled up; every other
 * unit is shown as it is kept.
 */
export function usageQty(n: number, unit: string): string {
  const u = unit.trim();
  const scaled = u.toLowerCase() === 'g' ? 'kg' : u.toLowerCase() === 'ml' ? 'L' : null;
  // Compared as it will be shown, so 999.996 g reads "1 kg", not "1,000 g".
  if (scaled && Math.abs(Math.round(n * 100) / 100) >= 1000) return `${amount(n / 1000)} ${scaled}`;
  return u ? `${amount(n)} ${u}` : amount(n);
}

function amount(n: number): string {
  // Two decimals is plenty for "8.12 L"; a pinch under one unit keeps more, so it never reads as 0.
  return n.toLocaleString('en-PH', { maximumFractionDigits: Math.abs(n) >= 1 ? 2 : 4 });
}

/** The day's ingredient usage, sent a little after the branch's closing time. */
export function dailyUsageMessage(u: UsageForAlert): string {
  const top = u.rows.slice(0, USAGE_ROWS_SHOWN);
  const blocks = top.map((r) => {
    const lines = [row(r.name, usageQty(r.total, r.unit))];
    /*
      The total already includes these, on their own lines under it like a
      receipt's modifiers. Saying so is what lets the owner ask "why did we
      throw out milk?" -- and a line each means neither amount is ever cut off.
    */
    if (r.wasted > 0) lines.push(row('  of it wasted', usageQty(r.wasted, r.unit)));
    if (r.writtenOff > 0) lines.push(row('  of it written off', usageQty(r.writtenOff, r.unit)));
    return lines.join('\n');
  });
  const costed = u.rows.filter((r) => r.costPrice > 0).length;

  const build = (shown: string[], more: number) => {
    const head = [
      '📋 <b>Ingredients used today</b>',
      // Names cut to length, so no shop name can push the list out of the message.
      place(clip(u.shopName, 120), u.branchName ? clip(u.branchName, 80) : null),
      escapeHtml(manilaDayLabel(u.day)),
    ];
    const tail: string[] = [];
    if (u.rows.length === 0) {
      // Only sent like this when something was sold, or for the late sales alone: say why the sheet is blank.
      tail.push(u.stillBeingMade > 0
        ? 'No ingredients were counted yet.'
        : u.lateSales > 0 ? 'No ingredients were counted.' : 'No ingredients were counted. The items sold may have no recipe yet.');
    } else {
      const body = [...shown];
      const hidden = more + (u.rows.length - top.length);
      if (hidden > 0) body.push(`+${hidden} more`);
      // No value line when nothing has a cost: "₱0.00" would read as "nothing was used".
      if (costed > 0) {
        body.push(RULE, row('VALUE AT COST', `₱${money(u.totalValue)}`));
        const uncosted = u.rows.length - costed;
        if (uncosted > 0) body.push(clip(`  ${uncosted} ${uncosted === 1 ? 'has' : 'have'} no cost, not counted`, WIDTH));
      }
      tail.push(`<pre>${escapeHtml(body.join('\n'))}</pre>`);
    }
    if (u.stillBeingMade > 0) {
      const n = u.stillBeingMade;
      tail.push(escapeHtml(`${qty(n)} item${n === 1 ? '' : 's'} still at the kitchen or bar screen ${n === 1 ? 'is' : 'are'} not counted yet.`));
    }
    if (u.lateSales > 0) tail.push(escapeHtml(lateSalesNote(u.lateSales)));
    if (u.countNote) tail.push(escapeHtml(clip(u.countNote, 200)));
    tail.push(escapeHtml('Full list: Inventory > Ingredients > Reports'));
    return [...head, ...tail].join('\n');
  };
  return fitItems(build, blocks, MESSAGE_LIMIT);
}

// ── day close ──────────────────────────────────────────────────────────────

/** Money owed, a void or a refund done by one person (or nobody recorded). */
export interface ByPerson { name: string | null; count: number; amount: number }

export interface CloseSummaryForAlert {
  shopName:   string;
  branchName: string | null;
  /** The business day, YYYY-MM-DD, Manila. */
  day:        string;
  /** When it was read: the summary covers the day up to here. */
  asOf:       Date;
  sales: {
    count: number;
    total: number;
    /** Raw PaymentMethod values, plus 'CHARGE' for sales on account. Merged into words here (GCash personal + business = GCash). */
    byMethod: Array<{ method: string; amount: number }>;
  };
  /** Tagged parts on today's sales. `cost` is the line's own cost, null when none was recorded. */
  tagged: Array<{ number: string | null; name: string; sold: number; cost: number | null; refunded: boolean }>;
  discounts: {
    total: number;
    /** `name` null: no approver was recorded (a promo, a senior or PWD discount). */
    byApprover: ByPerson[];
    /** Senior and PWD discounts: one per card shown. */
    seniorPwd: number;
  };
  voids:   { count: number; total: number; byPerson: ByPerson[] };
  refunds: { count: number; total: number; byPerson: ByPerson[] };
  /** Drawers closed today, in the order they closed. Nulls: closed without a count. */
  drawers: Array<{ cashier: string | null; expected: number | null; counted: number | null; variance: number | null }>;
  /** Sales today with a line under the menu price (orders/price-check). */
  belowMenu: number;
  /** A tag rung up on two sales (an offline till). */
  soldTwice: Array<{ tags: string[]; orderNumber: string | null }>;
  /** Roll calls done today, oldest first. */
  rollCalls: Array<{ at: Date; missing: number }>;
}

/** The order the owner reads the ways of paying in; a method not listed here comes after, as it is named. */
const CLOSE_METHOD_ORDER = ['Cash', 'GCash', 'Maya', 'QR Ph', 'Card', 'Charge'];

function peso(n: number): string {
  return n < 0 ? `-₱${money(-n)}` : `₱${money(n)}`;
}

function times(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "Anne: 2, ₱450.00"; nobody recorded gets `nobody`. */
function personLine(p: ByPerson, nobody: string): string {
  return `${p.name ? clip(p.name, 60) : nobody}: ${p.count}, ${peso(p.amount)}`;
}

function drawerLine(d: CloseSummaryForAlert['drawers'][number]): string {
  const who = d.cashier ? clip(d.cashier, 60) : 'A cashier no longer on staff';
  if (d.counted == null || d.expected == null) return `${who}: closed without a count`;
  const v = Math.round((d.variance ?? d.counted - d.expected) * 100) / 100;
  const result = Math.abs(v) < 0.005 ? 'exact' : v < 0 ? `short ${peso(-v)}` : `over ${peso(v)}`;
  return `${who}: expected ${peso(d.expected)}, counted ${peso(d.counted)}, ${result}`;
}

function taggedLine(t: CloseSummaryForAlert['tagged'][number], showCosts: boolean): string {
  const what = `${t.number ? `Tag ${t.number} ` : ''}${clip(t.name, 60)}`;
  const parts = [`sold ${peso(t.sold)}`];
  if (!showCosts) {
    // A part's cost is the owner's alone (the tag API shows it to no one else).
  } else if (t.cost == null) {
    parts.push('no cost recorded');
  } else {
    const margin = Math.round((t.sold - t.cost) * 100) / 100;
    parts.push(`cost ${peso(t.cost)}`, margin < 0 ? `loss ${peso(-margin)}` : `margin ${peso(margin)}`);
  }
  if (t.refunded) parts.push('refunded');
  return `${what}: ${parts.join(' · ')}`;
}

/** List caps tried in turn until the message fits: everything, then fewer and fewer of each list. */
const CLOSE_LIST_CAPS = [Infinity, 50, 25, 10, 5, 3, 1, 0];

/**
 * The day's close, sent at 21:30 Manila to the owner and the branch's
 * managers: what was sold and how it was paid, tagged parts (with their cost
 * and margin for the owner only, `showCosts`), discounts and who approved them, voids and refunds, the
 * drawers closed, and what the till flagged. A section with nothing in it is
 * left out; a day with nothing at all says so in one line.
 *
 * Plain lines, not a 32-wide receipt: a tagged part's line carries three
 * amounts and would wrap in a monospace block. Long lists keep their first
 * entries and count the rest in "…and N more", so it always fits one message.
 */
export function closeSummaryMessage(s: CloseSummaryForAlert, opts: { showCosts?: boolean } = {}): string {
  const showCosts = opts.showCosts ?? true;
  const bold = (t: string) => `<b>${escapeHtml(t)}</b>`;
  const item = (t: string) => `• ${escapeHtml(t)}`;
  const list = (rows: string[], cap: number) => {
    const shown = rows.slice(0, cap).map(item);
    const more = rows.length - shown.length;
    return more > 0 ? [...shown, escapeHtml(`…and ${more} more`)] : shown;
  };

  // Ways of paying, merged into the words the owner uses, in the owner's order.
  const methods = new Map<string, number>();
  for (const p of s.sales.byMethod) {
    const w = p.method === 'CHARGE' ? 'Charge' : paymentWord(p.method);
    methods.set(w, (methods.get(w) ?? 0) + p.amount);
  }
  const rank = (w: string) => { const i = CLOSE_METHOD_ORDER.indexOf(w); return i < 0 ? CLOSE_METHOD_ORDER.length : i; };
  const methodRows = [...methods.entries()]
    .filter(([, amount]) => Math.abs(amount) >= 0.005)
    .sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]))
    .map(([w, amount]) => `${w} ${peso(amount)}`);

  const build = (cap: number) => {
    const sections: string[][] = [];
    if (s.sales.count > 0) {
      sections.push([`${bold('Sales')}: ${escapeHtml(`${s.sales.count}, total ${peso(s.sales.total)}`)}`, ...methodRows.map(item)]);
    }
    if (s.tagged.length > 0) {
      sections.push([bold('Tagged parts sold'), ...list(s.tagged.map((t) => taggedLine(t, showCosts)), cap)]);
    }
    if (s.discounts.byApprover.length > 0 || s.discounts.seniorPwd > 0) {
      sections.push([
        `${bold('Discounts')}: ${escapeHtml(peso(s.discounts.total))}`,
        ...list(s.discounts.byApprover.map((p) => `${p.name ? `Approved by ${clip(p.name, 60)}` : 'No approver recorded'}: ${p.count}, ${peso(p.amount)}`), cap),
        ...(s.discounts.seniorPwd > 0 ? [item(`Senior/PWD: ${s.discounts.seniorPwd}`)] : []),
      ]);
    }
    const undone: string[] = [];
    if (s.voids.count > 0) {
      undone.push(`${bold('Voids')}: ${escapeHtml(`${s.voids.count}, total ${peso(s.voids.total)}`)}`,
        ...list(s.voids.byPerson.map((p) => personLine(p, 'Not recorded')), cap));
    }
    if (s.refunds.count > 0) {
      undone.push(`${bold('Refunds')}: ${escapeHtml(`${s.refunds.count}, total ${peso(s.refunds.total)}`)}`,
        ...list(s.refunds.byPerson.map((p) => personLine(p, 'Not recorded')), cap));
    }
    if (undone.length > 0) sections.push(undone);
    if (s.drawers.length > 0) {
      sections.push([bold('Cash drawers closed'), ...list(s.drawers.map(drawerLine), cap)]);
    }
    const flags: string[] = [];
    if (s.belowMenu > 0) flags.push(`⚠️ ${escapeHtml(`Sold below menu: ${times(s.belowMenu, 'sale')}`)}`);
    if (s.soldTwice.length > 0) {
      flags.push(`⚠️ ${bold('Tags sold twice')}`, ...list(s.soldTwice.map((t) => {
        const tags = t.tags.length > 0 ? t.tags.map((n) => `Tag ${clip(n, 20)}`).join(', ') : 'A tag';
        return t.orderNumber ? `${tags} on ${clip(t.orderNumber, 40)}` : tags;
      }), cap));
    }
    if (s.rollCalls.length > 0) {
      flags.push(bold('Roll call'), ...list(s.rollCalls.map((r) => `${manilaTime(r.at)}, missing: ${r.missing}`), cap));
    }
    if (flags.length > 0) sections.push(flags);

    const head = [
      `📊 ${bold(`Day close: ${manilaDayLabel(s.day)}`)}`,
      place(clip(s.shopName, 120), s.branchName ? clip(s.branchName, 80) : null),
      escapeHtml(`Up to ${manilaTime(s.asOf)}`),
    ];
    const body = sections.length > 0 ? sections.map((x) => x.join('\n')) : [escapeHtml('Nothing was recorded today: no sales, voids, refunds or drawers closed.')];
    return [head.join('\n'), ...body].join('\n\n');
  };

  for (const cap of CLOSE_LIST_CAPS) {
    const text = build(cap);
    if (text.length <= MESSAGE_LIMIT) return text;
  }
  // Every list cut to its count and still too long (a shop name cannot do this; clip bounds it): cut at a line.
  const text = build(0);
  return text.slice(0, text.lastIndexOf('\n', MESSAGE_LIMIT));
}
