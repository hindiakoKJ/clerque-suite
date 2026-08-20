import { mapLoyverseItems, looksLikeLoyverse } from './loyverse.mapper';

/**
 * The Loyverse export is not a fixed sheet — column order varies by account
 * and the price/stock columns are suffixed with each store's name, so the
 * mapper resolves columns by header text rather than position.
 */
describe('Loyverse migration mapper', () => {
  const HEADER = [
    'Handle', 'SKU', 'Item Name', 'Category', 'Description',
    'Option1 Name', 'Option1 Value', 'Track stock', 'Sold by weight',
    'Available for sale', 'Cost', 'Price', 'Barcode',
    'Price Main Store', 'In stock Main Store', 'In stock Kiosk 2',
    'Some Future Column',
  ];
  // Latte ships as two variants with a BLANK default price (store price only).
  const LATTE_S = ['latte', '10001', 'Cafe Latte', 'Hot Coffee', 'House blend',
    'Size', 'Small', 'Y', 'N', 'Y', '18.50', '', '4801234567890', '120', '25', '5', 'x'];
  const LATTE_L = ['latte', '10002', 'Cafe Latte', 'Hot Coffee', 'House blend',
    'Size', 'Large', 'Y', 'N', 'Y', '24.00', '', '4801234567891', '150', '12', '3', 'x'];
  const CHOCO   = ['choco', '10003', 'Hot Chocolate', 'Hot Coffee', '',
    '', '', 'Y', 'N', 'Y', '20.00', '130', '', '', '8', '2', ''];
  const MUFFIN  = ['muffin', '10004', 'Blueberry Muffin', 'Pastries', '',
    '', '', 'N', 'N', 'Y', '15.00', '75', '', '', '', '', ''];

  const rows = [HEADER, LATTE_S, LATTE_L, CHOCO, MUFFIN, []];

  it('recognises a Loyverse export', () => {
    expect(looksLikeLoyverse(rows)).toBe(true);
    expect(looksLikeLoyverse([['Name*', 'Category', 'Price*'], ['Latte', 'Coffee', '100']]))
      .toBe(false);
  });

  it('emits rows in the Clerque products template shape', () => {
    const { productRows } = mapLoyverseItems(rows);
    expect(productRows[0]).toEqual([
      'Name*', 'Category', 'Price*', 'Cost Price*', 'VAT (Y/N)', 'Barcode', 'Description',
    ]);
  });

  it('splits variants into distinct products so prices cannot collide', () => {
    const { productRows, variantsExpanded } = mapLoyverseItems(rows);
    const names = productRows.slice(1).map((r) => r[0]);
    expect(names).toContain('Cafe Latte - Small');
    expect(names).toContain('Cafe Latte - Large');
    expect(variantsExpanded).toBe(2);
  });

  it('falls back to a store price column when the default price is blank', () => {
    const { productRows } = mapLoyverseItems(rows);
    const small = productRows.find((r) => r[0] === 'Cafe Latte - Small')!;
    const large = productRows.find((r) => r[0] === 'Cafe Latte - Large')!;
    expect(small[2]).toBe('120');
    expect(large[2]).toBe('150');
  });

  it('keeps cost, category and barcode, using SKU when no barcode exists', () => {
    const { productRows } = mapLoyverseItems(rows);
    const small = productRows.find((r) => r[0] === 'Cafe Latte - Small')!;
    expect(small[1]).toBe('Hot Coffee');
    expect(small[3]).toBe('18.50');
    expect(small[5]).toBe('4801234567890');
    const choco = productRows.find((r) => r[0] === 'Hot Chocolate')!;
    expect(choco[5]).toBe('10003'); // no barcode → SKU
  });

  it('sums opening stock across every store column', () => {
    const { inventoryRows } = mapLoyverseItems(rows);
    const find = (n: string) => inventoryRows.find((r) => r[0] === n);
    expect(find('Cafe Latte - Small')![1]).toBe('30'); // 25 + 5
    expect(find('Cafe Latte - Large')![1]).toBe('15'); // 12 + 3
    expect(find('Hot Chocolate')![1]).toBe('10');      // 8 + 2
  });

  it('does not seed stock for items Loyverse was not tracking', () => {
    const { inventoryRows } = mapLoyverseItems(rows);
    expect(inventoryRows.find((r) => r[0] === 'Blueberry Muffin')).toBeUndefined();
  });

  it('reports the stores it found, in the owner\'s own capitalisation', () => {
    const { storesDetected } = mapLoyverseItems(rows);
    expect(storesDetected).toEqual(['Main Store', 'Kiosk 2']);
  });

  it('surfaces unmapped columns instead of dropping them silently', () => {
    const { unmappedHeaders } = mapLoyverseItems(rows);
    expect(unmappedHeaders).toContain('Some Future Column');
    expect(unmappedHeaders).toContain('Handle');
  });

  it('tolerates a title line above the real header', () => {
    const withTitle = [['Loyverse item list export'], [], ...rows];
    const { productRows } = mapLoyverseItems(withTitle);
    expect(productRows.length).toBe(5); // header + 4 items
  });

  it('tolerates reordered columns and different casing', () => {
    const reordered = [
      ['CATEGORY', 'item name', 'price', 'COST'],
      ['Tea', 'Iced Tea', '95', '12'],
    ];
    const { productRows } = mapLoyverseItems(reordered);
    expect(productRows[1]).toEqual(['Iced Tea', 'Tea', '95', '12', 'Y', '', '']);
  });

  it('keeps the first row when the same variant appears twice', () => {
    const dupe = [HEADER, LATTE_S, LATTE_S];
    const { productRows } = mapLoyverseItems(dupe);
    expect(productRows.filter((r) => r[0] === 'Cafe Latte - Small')).toHaveLength(1);
  });

  it('explains what to export when the file is unrecognisable', () => {
    expect(() => mapLoyverseItems([['total sales', '123']]))
      .toThrow(/Item list/i);
  });
});
