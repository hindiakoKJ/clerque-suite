/**
 * Which account a stocked item's cost belongs in.
 *
 * The dividing line is NOT edible-vs-not. It is whether the thing is consumed
 * with each unit SOLD, or consumed by the shop running.
 *
 *   - An ingredient becomes part of the drink. Its cost is an ASSET until the
 *     drink is sold, then it is cost of sale. Capitalise it.
 *   - Bleach, tissue and trash bags are consumed by the shop. They never enter
 *     a product, so they can never be relieved through a recipe — and a bucket
 *     with no exit only grows. Expense them on receipt.
 *
 * Packaging is the case that looks like the second and behaves like the first.
 * Cups, lids and straws ARE in the recipes and ARE relieved per drink, so they
 * stay INGREDIENT: capitalised, and released to cost of sale by the same BOM
 * walk as the milk. Calling one a supply is refused at the point of
 * reclassification precisely because it would strand those recipes.
 *
 * ─── Why this table exists at all ────────────────────────────────────────────
 *
 * Every raw-material receipt used to debit 1050 Merchandise Inventory, whatever
 * it was. Bleach and coffee beans produced byte-identical journal entries. The
 * category column existed but no posting code read it, so the classification
 * was decorative.
 *
 * The account is now DERIVED from what the item is, in one place, rather than
 * written as a literal wherever a posting happens. When a bookkeeper needs a
 * different mapping for a particular shop, this is the shape that moves into a
 * per-tenant setting — one lookup to redirect, not a hunt through the ledger
 * code.
 */

/** Mirrors RawMaterialCategory in the Prisma schema. */
export type MaterialCategory =
  | 'INGREDIENT'
  | 'KITCHEN_SUPPLY'
  | 'BAR_SUPPLY'
  | 'OFFICE_SUPPLY';

export interface MaterialAccountRule {
  /** Account debited when the item is RECEIVED. */
  onReceipt: string;
  /**
   * True when the receipt debit is an asset that must later be relieved.
   * False when the cost is already in the P&L and nothing further is owed.
   */
  capitalised: boolean;
  /** Human-readable reason, surfaced in the journal line. */
  label: string;
}

export const MATERIAL_ACCOUNTS: Record<MaterialCategory, MaterialAccountRule> = {
  // 1051, not 1050. Merchandise Inventory is for goods bought to resell as-is
  // (bottled water, a bag of beans on the shelf); raw materials that get made
  // into something are their own line on the inventory note and on the
  // RMC 57-2015 listing.
  INGREDIENT: {
    onReceipt:   '1051',
    capitalised: true,
    label:       'Raw materials',
  },
  KITCHEN_SUPPLY: {
    onReceipt:   '6210',
    capitalised: false,
    label:       'Kitchen supplies',
  },
  BAR_SUPPLY: {
    onReceipt:   '6210',
    capitalised: false,
    label:       'Bar supplies',
  },
  OFFICE_SUPPLY: {
    onReceipt:   '6070',
    capitalised: false,
    label:       'Office and cleaning supplies',
  },
};

/**
 * Falls back to INGREDIENT for anything unrecognised.
 *
 * The column is NOT NULL DEFAULT 'INGREDIENT', so an absent value can only
 * mean an older payload, never "we do not know what this is". Treating it as
 * an ingredient keeps the pre-existing behaviour (capitalise) rather than
 * silently expensing something that should have been an asset.
 */
export function accountsForMaterial(category: string | null | undefined): MaterialAccountRule {
  const key = (category ?? 'INGREDIENT') as MaterialCategory;
  return MATERIAL_ACCOUNTS[key] ?? MATERIAL_ACCOUNTS.INGREDIENT;
}

/**
 * Where a product's finished stock goes. Products bought to resell as-is are
 * merchandise; this is deliberately separate from the raw-material table above
 * so that moving one never quietly moves the other.
 */
export const PRODUCT_INVENTORY_ACCOUNT = '1050';
