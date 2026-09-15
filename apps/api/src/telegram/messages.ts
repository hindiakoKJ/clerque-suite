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

const PAYMENT_WORDS: Record<string, string> = {
  CASH: 'Cash',
  GCASH_PERSONAL: 'GCash',
  GCASH_BUSINESS: 'GCash',
  MAYA_PERSONAL: 'Maya',
  MAYA_BUSINESS: 'Maya',
  QR_PH: 'QR Ph',
  CARD: 'Card',
};

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
  payments: Array<{ method: string; amount: number }>;
  discountTypes: string[];
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
    for (const p of sale.payments) body.push(row(PAYMENT_WORDS[p.method] ?? p.method, money(p.amount)));

    const head = [
      `🧾 <b>Sale ${escapeHtml(sale.orderNumber)}</b>  ₱${money(sale.totalAmount)}`,
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
  lines: Array<{ name: string; unit: string; packsBought: number | null; packSize: number | null; packCost: number | null; received: boolean }>;
}

function boughtLines(req: RequestForAlert) {
  return req.lines.filter((l) => l.packsBought != null && l.packCost != null);
}

function boughtTotal(req: RequestForAlert): number {
  return boughtLines(req).reduce((t, l) => t + (l.packsBought ?? 0) * (l.packCost ?? 0), 0);
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

export function boughtMessage(req: RequestForAlert, recordedBy: string | null, at: Date, added: { items: number; value: number } | null = null): string {
  const lines = boughtLines(req);
  const blocks = lines.map((l) => [
    clip(l.name, WIDTH),
    row(`  ${packWords(l)}`, money((l.packsBought ?? 0) * (l.packCost ?? 0))),
  ].join('\n'));
  const build = (shown: string[], more: number) => {
    const body = [...shown];
    if (more > 0) body.push(`…and ${more} more`);
    body.push(RULE, row('TOTAL', `₱${money(boughtTotal(req))}`));
    return [
      added
        ? `✅ <b>Bought more: ${escapeHtml(req.requestNumber)}</b>  +₱${money(added.value)}`
        : `✅ <b>Bought: ${escapeHtml(req.requestNumber)}</b>  ₱${money(boughtTotal(req))}`,
      place(req.shopName, req.branchName),
      escapeHtml(`${recordedBy ? `Recorded by ${recordedBy} · ` : ''}${manilaTime(at)}`),
      ...(added ? [escapeHtml(`Added now: ${added.items} item${added.items === 1 ? '' : 's'}, ₱${money(added.value)}. Request total ₱${money(boughtTotal(req))}.`)] : []),
      `<pre>${escapeHtml(body.join('\n'))}</pre>`,
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
    items > 0 ? escapeHtml(`Bought on this request: ₱${money(boughtTotal(req))} (${items} item${items === 1 ? '' : 's'})`) : 'Nothing recorded as bought on this request yet.',
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
