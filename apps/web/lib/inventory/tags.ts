/**
 * Tags on the web: the shapes the tag API returns and the plain-word helpers
 * every Inventory screen and the till share (tasks/inventory-phase1-api.md).
 *
 * Free of React and of the api client so Node's own test runner can check it:
 *   cd apps/web && node --test lib/inventory/tags.spec.mjs
 */

export type TagStatus = 'WAITING_FOR_COST' | 'IN_STOCK' | 'SOLD' | 'RETIRED';

export interface TagPhotoRef { id: string; url: string }

/** One tagged piece, as GET /tags, POST /tags and the lookup return it. */
export interface Tag {
  id: string;
  number: string;
  status: TagStatus;
  productId: string;
  productName: string;
  sku: string | null;
  price: number | string;
  branchId: string;
  engineNumber: string | null;
  chassisNumber: string | null;
  notes: string | null;
  photos: TagPhotoRef[];
  /** Present only for the owner (or a role the shop lets see costs). */
  cost?: number | string | null;
  sellable: boolean;
  notSellableReason: string | null;
  soldOrderId: string | null;
  createdAt: string;
}

export interface LookupProduct {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  price: number | string;
}

export type LookupResult =
  | { kind: 'TAG'; tag: Tag }
  | { kind: 'PRODUCT'; product: LookupProduct }
  | { kind: 'NONE' };

export interface LabelRun {
  from: string;
  to: string;
  count: number;
  createdAt: string;
  createdByName: string | null;
}

export interface ReservedLabels { from: string; to: string; numbers: string[] }

/** A label number: exactly six digits, never mistaken for a retail barcode (8, 12, 13 or 14). */
export function isTagCode(code: string | null | undefined): boolean {
  return /^\d{6}$/.test((code ?? '').trim());
}

/**
 * What a scanner or a person typed, cleaned: scanners add a stray Enter or
 * space, and some send the label's digits with a leading "Tag".
 */
export function cleanCode(raw: string): string {
  return raw.trim().replace(/^tag\s*/i, '').trim();
}

/** Which identity number a product needs at tagging, from its SKU prefix (the API's rule). */
export function numberFieldFor(sku: string | null | undefined): 'ENGINE' | 'CHASSIS' | null {
  const s = (sku ?? '').trim().toUpperCase();
  if (s.startsWith('ENG-')) return 'ENGINE';
  if (s.startsWith('HC-') || s.startsWith('FRM-')) return 'CHASSIS';
  return null;
}

/** Engines, half-cuts and frame pieces: the buyer's name and address go on the sale. */
export function needsNamedBuyer(sku: string | null | undefined): boolean {
  return numberFieldFor(sku) !== null;
}

/** What the receipt prints for a tagged line, the same words the server writes into the line notes. */
export function tagLineNote(t: Pick<Tag, 'number' | 'engineNumber' | 'chassisNumber'>): string {
  const parts = [`Tag ${t.number}`];
  if (t.engineNumber) parts.push(`Engine No. ${t.engineNumber}`);
  if (t.chassisNumber) parts.push(`Chassis No. ${t.chassisNumber}`);
  return parts.join(' · ');
}

/** A tag's status in words for the shop floor. */
export function statusWords(status: string): string {
  switch (status) {
    case 'WAITING_FOR_COST': return 'Waiting for the owner\'s cost';
    case 'IN_STOCK':         return 'In stock, can be sold';
    case 'SOLD':             return 'Sold';
    case 'RETIRED':          return 'Written off';
    default:                 return status;
  }
}

/** Where the owner's money for a part came from, as POST /tags/:id/cost takes it. */
export const PAID_FROM = [
  { value: 'OWNER_FUNDED', label: 'Owner\'s money' },
  { value: 'BANK',         label: 'Bank / GCash' },
  { value: 'CASH',         label: 'Cash drawer' },
] as const;
export type PaidFrom = typeof PAID_FROM[number]['value'];

/**
 * A photo URL from the API, as a path the api client can fetch (its baseURL
 * already ends in /api/v1). The contract gives "/tags/photos/<id>"; an
 * absolute or /api/v1-prefixed URL is cut back to the same thing.
 */
export function photoApiPath(url: string): string {
  let path = url.trim();
  const abs = /^https?:\/\/[^/]+(\/.*)$/i.exec(path);
  if (abs) path = abs[1]!;
  path = path.replace(/^\/api\/v\d+(?=\/)/, '');
  return path.startsWith('/') ? path : `/${path}`;
}

/** The server's own words for a refusal, or a plain line when the request never reached it. */
export function apiErrorText(e: unknown, fallback: string): string {
  const r = (e as { response?: { data?: { message?: string | string[] } } })?.response;
  if (!r) return 'Could not reach Clerque. Check the connection and try again.';
  const m = r.data?.message;
  return (Array.isArray(m) ? m.join(' ') : m) || fallback;
}
