/**
 * Where something was bought, in words.
 *
 * A purchase line carries a kind (the palengke, a grocery, online, a
 * supplier) and a store name as the shopper calls it ("Puregold", "Shopee").
 * Both are optional: a palengke run often has no store name worth typing, and
 * every line bought before this existed has neither.
 *
 * Two spellings of one store are one store: names are grouped by their
 * lower-cased, space-collapsed form, and shown the way they were typed most
 * recently. A line with only a kind is grouped by the kind.
 *
 * The request screen, the PDF, the where-bought report and the server all use
 * this file, so "usually from" means the same thing everywhere.
 */

export const SOURCE_KINDS = ['MARKET', 'GROCERY', 'ONLINE', 'SUPPLIER', 'OTHER'] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

/** For a chip or a dropdown. */
export const SOURCE_KIND_LABEL: Record<SourceKind, string> = {
  MARKET:   'Palengke',
  GROCERY:  'Grocery',
  ONLINE:   'Online',
  SUPPLIER: 'Supplier',
  OTHER:    'Other',
};

export function isSourceKind(v: unknown): v is SourceKind {
  return typeof v === 'string' && (SOURCE_KINDS as readonly string[]).includes(v);
}

/** A kind typed or picked in words ("palengke", "Online") back to its code; null when it is none of them. */
export function sourceKindFromLabel(v: string | null | undefined): SourceKind | null {
  const t = String(v ?? '').trim().toLowerCase();
  if (!t) return null;
  const hit = SOURCE_KINDS.find((k) => k.toLowerCase() === t || SOURCE_KIND_LABEL[k].toLowerCase() === t);
  if (hit) return hit;
  if (t === 'market' || t === 'wet market') return 'MARKET';
  if (t === 'supermarket') return 'GROCERY';
  return null;
}

/** A typed store name, tidied: trimmed, inner spaces collapsed. Blank is null. */
export function cleanSourceName(name: string | null | undefined): string | null {
  const t = String(name ?? '').replace(/\s+/g, ' ').trim();
  return t ? t : null;
}

/** What two lines from the same store share. Null when the line says nothing about where. */
export function sourceKey(kind: string | null | undefined, name: string | null | undefined): string | null {
  const n = cleanSourceName(name);
  if (n) return `name:${n.toLowerCase()}`;
  return isSourceKind(kind) ? `kind:${kind}` : null;
}

/** "Puregold (grocery)", "Shopee (online)", "Palengke", or null. */
export function sourceText(kind: string | null | undefined, name: string | null | undefined): string | null {
  const n = cleanSourceName(name);
  const k = isSourceKind(kind) ? kind : null;
  if (n && k && SOURCE_KIND_LABEL[k].toLowerCase() !== n.toLowerCase()) return `${n} (${SOURCE_KIND_LABEL[k].toLowerCase()})`;
  if (n) return n;
  return k ? SOURCE_KIND_LABEL[k] : null;
}

export interface SourcedPurchase {
  sourceKind: string | null;
  sourceName: string | null;
  /** When it was bought; the newest spelling of a store is the one shown. */
  on: Date | string;
}

export interface UsuallyFrom {
  kind: SourceKind | null;
  name: string | null;
  /** How many of the purchases looked at were from this store. */
  times: number;
  /** How many purchases were looked at, with or without a store. */
  of: number;
}

const time = (d: Date | string) => new Date(d).getTime();

/**
 * The store an item is bought from most often. Ties go to the store used most
 * recently. Null when none of the purchases says where.
 */
export function usuallyFrom(purchases: SourcedPurchase[]): UsuallyFrom | null {
  const groups = new Map<string, { times: number; newest: SourcedPurchase }>();
  for (const p of purchases) {
    const key = sourceKey(p.sourceKind, p.sourceName);
    if (!key) continue;
    const g = groups.get(key);
    if (!g) groups.set(key, { times: 1, newest: p });
    else {
      g.times += 1;
      if (time(p.on) > time(g.newest.on)) g.newest = p;
    }
  }
  let best: { times: number; newest: SourcedPurchase } | null = null;
  for (const g of groups.values()) {
    if (!best || g.times > best.times || (g.times === best.times && time(g.newest.on) > time(best.newest.on))) best = g;
  }
  if (!best) return null;
  return {
    kind:  isSourceKind(best.newest.sourceKind) ? best.newest.sourceKind : null,
    name:  cleanSourceName(best.newest.sourceName),
    times: best.times,
    of:    purchases.length,
  };
}

/**
 * "Usually from Puregold (grocery): 3 of the last 4 buys". Only "usually" when
 * it is more than half: purchases recorded before stores were, or without one,
 * still count in "of", and 1 of 10 is not usually. Null when there is nothing to say.
 */
export function usuallyFromText(u: UsuallyFrom | null | undefined): string | null {
  if (!u) return null;
  const where = sourceText(u.kind, u.name);
  if (!where) return null;
  if (u.of <= 1) return `Last bought from ${where}`;
  return u.times * 2 > u.of
    ? `Usually from ${where}: ${u.times} of the last ${u.of} buys`
    : `From ${where} ${u.times} of the last ${u.of} buys`;
}
