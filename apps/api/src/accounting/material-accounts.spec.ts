import { accountsForMaterial, MATERIAL_ACCOUNTS, PRODUCT_INVENTORY_ACCOUNT } from './material-accounts';

/**
 * Which account a stocked item's cost belongs in.
 *
 * Every raw-material receipt used to debit 1050 Merchandise Inventory whatever
 * it was, so bleach and coffee beans produced identical journal entries. The
 * category column existed and no posting code read it.
 *
 * The dividing line is not edible-vs-not. It is whether the item is consumed
 * with each unit SOLD (capitalise, relieve through the recipe) or consumed by
 * the shop running (expense on receipt, because a bucket with no exit only
 * grows — a supply can never be in a recipe, so nothing could ever relieve it).
 */
describe('accountsForMaterial', () => {
  it('capitalises an ingredient to raw materials, not merchandise', () => {
    const r = accountsForMaterial('INGREDIENT');
    expect(r.onReceipt).toBe('1051');
    expect(r.capitalised).toBe(true);
    // 1050 is for goods bought to resell as-is. Raw materials that get MADE
    // into something are their own line on the inventory note.
    expect(r.onReceipt).not.toBe(PRODUCT_INVENTORY_ACCOUNT);
  });

  it.each([
    ['KITCHEN_SUPPLY', '6210'],
    ['BAR_SUPPLY',     '6210'],
    ['OFFICE_SUPPLY',  '6070'],
  ])('expenses %s on receipt to %s', (category, account) => {
    const r = accountsForMaterial(category);
    expect(r.onReceipt).toBe(account);
    expect(r.capitalised).toBe(false);
  });

  it('never routes a supply to an inventory asset account', () => {
    // The failure this prevents: a balance in 1050 or 1051 that nothing can
    // relieve, growing forever, because supplies are barred from recipes.
    const ASSETS = ['1050', '1051', '1052', '1053', '1054'];
    for (const c of ['KITCHEN_SUPPLY', 'BAR_SUPPLY', 'OFFICE_SUPPLY']) {
      expect(ASSETS).not.toContain(accountsForMaterial(c).onReceipt);
    }
  });

  describe('unknown or missing category', () => {
    // The column is NOT NULL DEFAULT 'INGREDIENT', so an absent value can only
    // mean an older payload — never "we do not know what this is".
    it.each([[null], [undefined], ['']])('treats %p as an ingredient', (v) => {
      expect(accountsForMaterial(v as string | null | undefined).onReceipt).toBe('1051');
    });

    it('falls back to capitalising, not expensing', () => {
      // Guessing "expense" on an unknown would silently move an asset into the
      // P&L. Guessing "capitalise" preserves the behaviour that existed before
      // the column was read at all.
      expect(accountsForMaterial('SOMETHING_NEW').capitalised).toBe(true);
    });
  });

  it('gives every category a label the journal line can carry', () => {
    for (const [category, rule] of Object.entries(MATERIAL_ACCOUNTS)) {
      expect(rule.label.length).toBeGreaterThan(0);
      expect(rule.onReceipt).toMatch(/^\d{4}$/);
      expect(typeof rule.capitalised).toBe('boolean');
      expect(category).toBeTruthy();
    }
  });

  it('keeps product inventory separate from raw materials', () => {
    // Two tables on purpose: moving one must never quietly move the other.
    expect(PRODUCT_INVENTORY_ACCOUNT).toBe('1050');
    expect(MATERIAL_ACCOUNTS.INGREDIENT.onReceipt).not.toBe(PRODUCT_INVENTORY_ACCOUNT);
  });
});
