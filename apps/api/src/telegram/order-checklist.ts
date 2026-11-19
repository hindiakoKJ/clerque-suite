import type { InlineKeyboard } from './telegram.client';
import { escapeHtml } from './messages';

/**
 * The staff supplies checklist in Telegram (KJ, 2026-11-19), as pure functions.
 *
 * Staff tap what is running low instead of asking in the group chat. The
 * checklist keeps no state on the server: how many of each item is ticked
 * rides in the buttons themselves, so a redeploy in the middle of somebody's
 * order loses nothing, and two phones never share one order by accident.
 *
 * One row per item: [✅ Bleach ×2] [−]. Tapping the name adds one, tapping −
 * takes one off. The − button carries the count ("o-:<id>:<n>"), which is the
 * only place it is kept; the name button only says which item ("o+:<id>").
 * Telegram allows 64 bytes of callback data and 100 buttons per message, so
 * the list is capped at MAX_ITEMS rows plus the Send / Cancel row.
 */

export const MAX_ITEMS = 45;
export const MAX_QTY = 99;

export interface ChecklistItem { id: string; name: string; low: boolean }

export type ChecklistTap =
  | { kind: 'add'; id: string }
  | { kind: 'remove'; id: string }
  | { kind: 'send' }
  | { kind: 'cancel' };

/** What a tapped button means, or null for anything that is not ours. */
export function readTap(data: string | undefined | null): ChecklistTap | null {
  if (!data) return null;
  if (data === 'os') return { kind: 'send' };
  if (data === 'ox') return { kind: 'cancel' };
  const m = /^o([+-]):([a-z0-9]+)(?::\d+)?$/i.exec(data);
  if (!m) return null;
  return m[1] === '+' ? { kind: 'add', id: m[2] } : { kind: 'remove', id: m[2] };
}

/** The counts the checklist on screen holds, read back from its buttons. */
export function readCounts(markup: InlineKeyboard | undefined | null): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of markup?.inline_keyboard ?? []) {
    for (const b of row) {
      const m = /^o-:([a-z0-9]+):(\d+)$/i.exec(b.callback_data ?? '');
      if (m) counts.set(m[1], Math.min(MAX_QTY, Number(m[2])));
    }
  }
  return counts;
}

/** The items in the order they are shown: what is low first, then by name. */
export function orderItems(items: ChecklistItem[]): ChecklistItem[] {
  return [...items]
    .sort((a, b) => (a.low === b.low ? a.name.localeCompare(b.name) : a.low ? -1 : 1))
    .slice(0, MAX_ITEMS);
}

/** Applies one tap to the counts. */
export function applyTap(counts: Map<string, number>, tap: ChecklistTap, known: Set<string>): Map<string, number> {
  const next = new Map(counts);
  if (tap.kind === 'add' && known.has(tap.id)) next.set(tap.id, Math.min(MAX_QTY, (next.get(tap.id) ?? 0) + 1));
  if (tap.kind === 'remove') next.set(tap.id, Math.max(0, (next.get(tap.id) ?? 0) - 1));
  return next;
}

/** Button text is plain, at most 64 characters on Telegram's side; long names are cut. */
function label(item: ChecklistItem, n: number): string {
  const name = item.name.length > 40 ? `${item.name.slice(0, 39)}…` : item.name;
  return `${n > 0 ? '✅' : '▫️'} ${name}${n > 0 ? ` ×${n}` : ''}${item.low && n === 0 ? ' (low)' : ''}`;
}

export function buildKeyboard(items: ChecklistItem[], counts: Map<string, number>): InlineKeyboard {
  const rows = items.map((it) => {
    const n = counts.get(it.id) ?? 0;
    return [
      { text: label(it, n), callback_data: `o+:${it.id}` },
      { text: '−', callback_data: `o-:${it.id}:${n}` },
    ];
  });
  const total = [...counts.values()].filter((n) => n > 0).length;
  rows.push([
    { text: total > 0 ? `📤 Send (${total})` : '📤 Send', callback_data: 'os' },
    { text: 'Cancel', callback_data: 'ox' },
  ]);
  return { inline_keyboard: rows };
}

export function checklistText(shopName: string, branchName: string | null, truncated: boolean): string {
  return [
    `🧽 <b>Supplies for ${escapeHtml(shopName)}</b>${branchName ? ` · ${escapeHtml(branchName)}` : ''}`,
    'Tap an item to add one, tap − to take one off, then <b>Send</b>.',
    'It goes on the next buy list. The owner decides how many to buy.',
    truncated
      ? 'Not every supply fits here. Not listed? Send <code>/need item, how many</code>.'
      : 'Not listed? Send <code>/need item, how many</code> — for example <code>/need Tissue roll, 2</code>.',
  ].join('\n');
}

/**
 * "/need Tissue roll, 2" -> { name: 'Tissue roll', qty: 2 }. The count may
 * also come last without a comma ("/need tissue roll 2"); none means one.
 */
export function readNeed(text: string): { name: string; qty: number } | null {
  const body = text.replace(/^\/need(@\w+)?/i, '').trim();
  if (!body) return null;
  const m = /^(.*?)[,\s]+(?:x\s*)?(\d{1,3})\s*$/i.exec(body);
  const name = (m ? m[1] : body).replace(/[,\s]+$/, '').replace(/\s+/g, ' ').trim();
  const qty = m ? Number(m[2]) : 1;
  if (name.length < 2 || name.length > 80 || !(qty >= 1 && qty <= MAX_QTY)) return null;
  return { name, qty };
}
