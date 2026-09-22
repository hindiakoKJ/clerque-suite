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
