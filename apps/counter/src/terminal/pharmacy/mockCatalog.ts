/**
 * PH-realistic mock catalog for the pharmacy terminal.
 *
 * Drug schedule classes follow Philippine FDA / DDB convention:
 *   - OTC    : Over-the-counter (no Rx)
 *   - RX     : Requires prescription
 *   - DDB_S2 : Dangerous Drugs Board Schedule II (controlled, supervisor PIN)
 *
 * Batches have lot #, qty remaining, expiry, and unit cost (₱ cents).
 * `LotPicker` UI uses earliest expiry = FEFO as the default selection.
 */

export type DrugSchedule = 'OTC' | 'RX' | 'DDB_S2';

export interface Batch {
  lotId: string;
  qtyRemaining: number;
  /** ISO date string. */
  expiresAt: string;
  /** ₱ cents — for inventory reporting; never shown big. */
  unitCostCents: number;
}

export interface Drug {
  sku: string;
  brandName: string;
  genericName: string;
  dosageForm: string;        // "500 mg tab", "200 puffs inhaler"...
  schedule: DrugSchedule;
  /** Retail price (₱ cents). */
  priceCents: number;
  batches: Batch[];
}

/** Helper — returns an ISO date `days` from today (00:00 local-ish). */
function dateInDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

export const MOCK_CATALOG: Drug[] = [
  // 1) Biogesic — OTC, 3 batches (all green expiry).
  {
    sku: 'PH-BIO-500',
    brandName: 'Biogesic 500 mg',
    genericName: 'Paracetamol',
    dosageForm: '10 tabs',
    schedule: 'OTC',
    priceCents: 2450,
    batches: [
      { lotId: 'B2025-08', qtyRemaining: 120, expiresAt: dateInDays(720), unitCostCents: 1800 },
      { lotId: 'B2025-09', qtyRemaining: 80,  expiresAt: dateInDays(640), unitCostCents: 1800 },
      { lotId: 'B2026-01', qtyRemaining: 240, expiresAt: dateInDays(900), unitCostCents: 1850 },
    ],
  },

  // 2) Amoxicillin — RX, 2 batches.
  {
    sku: 'PH-AMOX-500',
    brandName: 'Amoxicillin 500 mg',
    genericName: 'Amoxicillin trihydrate',
    dosageForm: '10 caps',
    schedule: 'RX',
    priceCents: 8800,
    batches: [
      { lotId: 'A2024-19', qtyRemaining: 32, expiresAt: dateInDays(540), unitCostCents: 6500 },
      { lotId: 'A2025-04', qtyRemaining: 54, expiresAt: dateInDays(720), unitCostCents: 6700 },
    ],
  },

  // 3) Cetirizine — OTC.
  {
    sku: 'PH-CET-10',
    brandName: 'Cetirizine 10 mg',
    genericName: 'Cetirizine HCl',
    dosageForm: '10 tabs',
    schedule: 'OTC',
    priceCents: 3200,
    batches: [
      { lotId: 'C2025-04', qtyRemaining: 142, expiresAt: dateInDays(820), unitCostCents: 2200 },
    ],
  },

  // 4) Diazepam 5mg — DDB_S2 controlled. Supervisor PIN required to dispense.
  {
    sku: 'PH-DIAZ-5',
    brandName: 'Diazepam 5 mg',
    genericName: 'Diazepam',
    dosageForm: '10 tabs',
    schedule: 'DDB_S2',
    priceCents: 7800,
    batches: [
      { lotId: 'Di2024-14', qtyRemaining: 12, expiresAt: dateInDays(380), unitCostCents: 5200 },
    ],
  },

  // 5) Salbutamol Inhaler — RX.
  {
    sku: 'PH-SALB-INH',
    brandName: 'Salbutamol Inhaler',
    genericName: 'Salbutamol sulfate',
    dosageForm: '200 puffs',
    schedule: 'RX',
    priceCents: 28500,
    batches: [
      { lotId: 'Sa2025-03', qtyRemaining: 8, expiresAt: dateInDays(880), unitCostCents: 18000 },
    ],
  },

  // 6) Loperamide — OTC.
  {
    sku: 'PH-LOP-2',
    brandName: 'Loperamide 2 mg',
    genericName: 'Loperamide HCl',
    dosageForm: '10 caps',
    schedule: 'OTC',
    priceCents: 1850,
    batches: [
      { lotId: 'L2025-09', qtyRemaining: 320, expiresAt: dateInDays(800), unitCostCents: 1100 },
    ],
  },

  // 7) Metformin — RX, 2 batches. One expires in 20 days = red, the other amber-ish.
  {
    sku: 'PH-MET-500',
    brandName: 'Metformin 500 mg',
    genericName: 'Metformin HCl',
    dosageForm: '10 tabs',
    schedule: 'RX',
    priceCents: 4200,
    batches: [
      { lotId: 'M2024-03', qtyRemaining: 18, expiresAt: dateInDays(20),  unitCostCents: 2400 }, // red (<30d)
      { lotId: 'M2024-22', qtyRemaining: 96, expiresAt: dateInDays(60),  unitCostCents: 2500 }, // amber (30-90d)
      { lotId: 'M2025-08', qtyRemaining: 200, expiresAt: dateInDays(540), unitCostCents: 2600 }, // green
    ],
  },
];

/** Days-until-expiry tier for badge colour. */
export type ExpiryTier = 'OK' | 'AMBER' | 'RED';

export function expiryTier(expiresAtIso: string): ExpiryTier {
  const ms = new Date(expiresAtIso).getTime() - Date.now();
  const days = ms / (1000 * 60 * 60 * 24);
  if (days < 30) return 'RED';
  if (days < 90) return 'AMBER';
  return 'OK';
}

/** Sort batches FEFO (earliest expiry first). */
export function sortFEFO(batches: Batch[]): Batch[] {
  return [...batches].sort(
    (a, b) => new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime()
  );
}

/**
 * Live catalog registry — populated by PharmacyTerminal from the Cloud
 * `/products/pos` payload. When live data is present, `findDrug` and
 * `searchDrugs` consume it instead of the in-file mock array. The mock is
 * preserved as a __DEV__ / cold-launch fallback (see PharmacyTerminal).
 *
 * NOTE: live `Drug` rows carry the same shape as the mock, but their
 * `batches` array is populated lazily — per-product lot data comes from
 * `GET /pharmacy/lots/available?productId&branchId`, which is too many
 * round-trips to issue eagerly for a full search page. The BatchPickerSheet
 * fetches lots on demand when the pharmacist opens the picker; the
 * BatchExpiryChip row uses `batches` directly, so live rows render with a
 * single synthetic "stock-summary" batch until the picker fetches real
 * lots. (See PharmacyTerminal for the synthesizer.)
 */
let LIVE_CATALOG: Drug[] | null = null;

/** Replace the live registry. Pass `null` (or an empty array) to disable. */
export function setLiveCatalog(rows: Drug[] | null): void {
  LIVE_CATALOG = rows && rows.length > 0 ? rows : null;
}

function activeCatalog(): Drug[] {
  return LIVE_CATALOG ?? (__DEV__ ? MOCK_CATALOG : []);
}

export function findDrug(sku: string): Drug | undefined {
  return activeCatalog().find((d) => d.sku === sku);
}

export function searchDrugs(query: string): Drug[] {
  const cat = activeCatalog();
  const q = query.trim().toLowerCase();
  if (!q) return cat;
  return cat.filter(
    (d) =>
      d.sku.toLowerCase().includes(q) ||
      d.brandName.toLowerCase().includes(q) ||
      d.genericName.toLowerCase().includes(q)
  );
}
