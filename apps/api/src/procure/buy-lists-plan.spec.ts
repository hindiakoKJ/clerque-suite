import { planBuyListRows, SheetRow, ExistingLine, PlanInput } from './buy-lists-plan';

/**
 * What an uploaded buy-list sheet would change, before anything is written.
 * The sheet may record what was bought; it may never change what is already
 * in stock, a paid-ahead order's money, a correction made in Clerque since the
 * download, or add stock by itself.
 */
describe('buy-list sheet plan', () => {
  const TODAY = '2026-09-14';
  const MAIN = { id: 'b1', name: 'Main' };
  const row = (n: number, over: Partial<SheetRow> = {}): SheetRow => ({
    rowNumber: n, lineNumber: '', branch: '', item: '', boughtOn: '', packs: '', packSize: '', packUnit: '', pricePerPack: '', brand: '', boughtAt: '', store: '',
    rowKey: '', was: null, ...over,
  });
  const line = (over: Partial<ExistingLine> = {}): ExistingLine => ({
    lineId: 'l1', lineNumber: 'REQ-20260913-001-01', requestId: 'r1', requestNumber: 'REQ-20260913-001', requestStatus: 'SENT',
    prepaid: false, fromSheet: false, sheetRowKey: null, branchId: 'b1', branchName: 'Main', rawMaterialId: 'rm-milk', itemName: 'Full Cream Milk', unit: 'ml',
    packsBought: null, packSize: null, packCost: null, brandNote: null, sourceKind: null, sourceName: null, boughtOn: null, receivedAt: null, ...over,
  });
  const MATERIALS = [
    { id: 'rm-milk', name: 'Full Cream Milk', unit: 'ml', isActive: true, isPrep: false },
    { id: 'rm-sugar', name: 'White Sugar', unit: 'g', isActive: true, isPrep: false },
    { id: 'rm-sugar-old', name: 'White Sugar', unit: 'g', isActive: false, isPrep: false },
    { id: 'rm-sauce', name: 'Teriyaki Sauce (ready)', unit: 'ml', isActive: true, isPrep: true },
    { id: 'rm-old', name: 'Old Syrup', unit: 'ml', isActive: false, isPrep: false },
    { id: 'rm-a', name: 'Salt', unit: 'g', isActive: true, isPrep: false },
    { id: 'rm-b', name: 'SALT', unit: 'g', isActive: true, isPrep: false },
  ];
  const plan = (rows: SheetRow[], over: Partial<PlanInput> = {}) =>
    planBuyListRows({ rows, lines: [line()], materials: MATERIALS, branches: [MAIN], canAddNew: true, today: TODAY, ...over });
  const reason = (v: unknown) => (v as { reason?: string }).reason;

  // ── lines already on a request ────────────────────────────────────────────

  it('fills a line not yet in stock, with the pack size turned into the ingredient\'s unit', () => {
    const [v] = plan([row(2, {
      lineNumber: 'REQ-20260913-001-01', item: 'Full Cream Milk', packs: '3', packSize: '1', packUnit: 'L', pricePerPack: '₱86.50', brand: 'Emborg', boughtOn: '2026-09-13',
      boughtAt: 'grocery', store: '  Puregold   Tagaytay ',
    })]);
    expect(v).toEqual({
      kind: 'FILL', rowNumber: 2, lineNumber: 'REQ-20260913-001-01', item: 'Full Cream Milk', unit: 'ml', lineId: 'l1', requestId: 'r1',
      packsBought: 3, packSize: 1000, packCost: 86.5, brandNote: 'Emborg', boughtOn: '2026-09-13',
      sourceKind: 'GROCERY', sourceName: 'Puregold Tagaytay',
    });
  });

  it('where it was bought: blank keeps what Clerque has, a change is an edit, a word it does not know is refused', () => {
    const atPuregold = line({ packsBought: 3, packSize: 1000, packCost: 86.5, brandNote: 'Emborg', boughtOn: '2026-09-13', requestStatus: 'BOUGHT', sourceKind: 'GROCERY', sourceName: 'Puregold' });
    const was = { item: 'Full Cream Milk', boughtOn: '2026-09-13', packs: '3', packSize: '1000', pricePerPack: '86.5', brand: 'Emborg', boughtAt: 'Grocery', store: 'Puregold' };
    const r = (over: Partial<SheetRow>) => row(2, {
      lineNumber: 'REQ-20260913-001-01', item: 'Full Cream Milk', boughtOn: '2026-09-13', packs: '3', packSize: '1000', packUnit: 'ml', pricePerPack: '86.5', brand: 'Emborg',
      boughtAt: 'Grocery', store: 'Puregold', was, ...over,
    });
    expect(plan([r({})], { lines: [atPuregold] })[0].kind).toBe('UNCHANGED');
    // Cleared in the file: blank keeps the store, like a blank brand.
    expect(plan([r({ boughtAt: '', store: '' })], { lines: [atPuregold] })[0].kind).toBe('UNCHANGED');
    // A price fix leaves the store as it is.
    expect(plan([r({ pricePerPack: '88' })], { lines: [atPuregold] })[0]).toMatchObject({ kind: 'FILL', packCost: 88, sourceKind: 'GROCERY', sourceName: 'Puregold' });
    // The store changed in the file only.
    expect(plan([r({ boughtAt: 'Online', store: 'Shopee' })], { lines: [atPuregold] })[0]).toMatchObject({ kind: 'FILL', sourceKind: 'ONLINE', sourceName: 'Shopee' });
    // Changed in Clerque since the download, and in the file too: download again.
    expect(reason(plan([r({ store: 'S&R' })], { lines: [{ ...atPuregold, sourceName: 'Robinsons' }] })[0])).toMatch(/was changed in Clerque after this file was downloaded/);
    expect(reason(plan([r({ boughtAt: 'Sari-sari' })], { lines: [atPuregold] })[0])).toBe('Bought at has to be one of Palengke, Grocery, Online, Supplier, Other.');
    // Only the store changed on a line already in stock: said as that, not "correct it under Stock on hand".
    expect(reason(plan([r({ store: 'S&R' })], { lines: [{ ...atPuregold, receivedAt: new Date() }] })[0]))
      .toBe('Bought at and Store can only be filled in from the sheet before Full Cream Milk (REQ-20260913-001-01) is in stock; it stays as recorded.');
    // A long name cut on a space is stored without the space, and reads back as the same store.
    const long = `${'A'.repeat(79)} Plaza`;
    const cut = plan([r({ store: long })], { lines: [atPuregold] })[0] as { sourceName: string };
    expect(cut.sourceName).toBe('A'.repeat(79));
    expect(plan([r({ store: long })], { lines: [{ ...atPuregold, sourceName: 'A'.repeat(79) }] })[0].kind).toBe('UNCHANGED');
    // A file made before the store columns existed: no "was", nothing to drift from.
    const oldWas = { item: 'Full Cream Milk', boughtOn: '2026-09-13', packs: '3', packSize: '1000', pricePerPack: '86.5', brand: 'Emborg' };
    expect(plan([r({ was: oldWas, boughtAt: '', store: '', pricePerPack: '88' })], { lines: [atPuregold] })[0]).toMatchObject({ kind: 'FILL', packCost: 88, sourceName: 'Puregold' });
  });

  const filledLine = line({ packsBought: 3, packSize: 1000, packCost: 86.5, brandNote: 'Emborg', boughtOn: '2026-09-13', requestStatus: 'BOUGHT' });
  const asDownloaded = { item: 'Full Cream Milk', boughtOn: '2026-09-13', packs: '3', packSize: '1000', pricePerPack: '86.5', brand: 'Emborg' };
  const downloadedRow = (n: number, over: Partial<SheetRow> = {}) => row(n, {
    lineNumber: 'REQ-20260913-001-01', item: 'Full Cream Milk', boughtOn: '2026-09-13', packs: '3', packSize: '1000', packUnit: 'ml', pricePerPack: '86.5', brand: 'Emborg',
    was: asDownloaded, ...over,
  });

  it('an untouched row is unchanged, allowing for Excel\'s rounding', () => {
    expect(plan([downloadedRow(2, { pricePerPack: '86.50000000001' })], { lines: [filledLine] })[0].kind).toBe('UNCHANGED');
    expect(plan([row(3, { lineNumber: 'REQ-20260913-001-01' })], { lines: [filledLine] })[0].kind).toBe('UNCHANGED');
  });

  it('an old file uploaded again does not undo a correction made in Clerque since the download', () => {
    // Downloaded at 86.50; the manager corrected it to 90 in the app; the file's row was not touched.
    const corrected = { ...filledLine, packCost: 90 };
    expect(plan([downloadedRow(2)], { lines: [corrected] })[0].kind).toBe('UNCHANGED');
    // Touched in the file AND changed in Clerque: refused, download again.
    const [both] = plan([downloadedRow(2, { pricePerPack: '88' })], { lines: [corrected] });
    expect(reason(both)).toBe('Full Cream Milk (REQ-20260913-001-01) was changed in Clerque after this file was downloaded. Download the file again and make the change there.');
    // Touched only in the file: filled.
    expect(plan([downloadedRow(2, { pricePerPack: '88' })], { lines: [filledLine] })[0]).toMatchObject({ kind: 'FILL', packCost: 88, brandNote: 'Emborg' });
    // The same file uploaded again after that fill was recorded: Clerque already says 88, so nothing changes.
    expect(plan([downloadedRow(2, { pricePerPack: '88' })], { lines: [{ ...filledLine, packCost: 88 }] })[0].kind).toBe('UNCHANGED');
  });

  it('an ingredient renamed in Clerque since the download is not an edit; typing over the item is refused', () => {
    const renamed = { ...filledLine, itemName: 'Fresh Milk' };
    expect(plan([downloadedRow(2, { pricePerPack: '88' })], { lines: [renamed] })[0].kind).toBe('FILL');
    const [typed] = plan([downloadedRow(2, { item: 'White Sugar' })], { lines: [filledLine] });
    expect(reason(typed)).toBe('The item on REQ-20260913-001-01 cannot be changed in the sheet. To buy something else, use an empty row.');
  });

  it('refuses a change to a line already in stock, a paid-ahead order, and a request that cannot take it', () => {
    const typed = { lineNumber: 'REQ-20260913-001-01', item: 'Full Cream Milk', packs: '2', packSize: '1000', pricePerPack: '90' };
    const cases: Array<[Partial<ExistingLine>, RegExp]> = [
      [{ receivedAt: new Date() }, /already in stock/],
      [{ prepaid: true, requestStatus: 'BOUGHT' }, /paid ahead/],
      [{ requestStatus: 'OPEN' }, /has not been sent yet/],
      [{ requestStatus: 'CANCELLED' }, /cancelled/],
      [{ requestStatus: 'RECEIVED' }, /closed .* went back on the list/],
    ];
    for (const [over, why] of cases) {
      const [v] = plan([row(2, typed)], { lines: [line(over)] });
      expect(v).toMatchObject({ kind: 'REFUSED', rowNumber: 2 });
      expect(reason(v)).toMatch(why);
    }
  });

  it('refuses a half-filled row, an item changed on a line, an unknown line, a line twice, and two bought-on dates for one request', () => {
    const second = line({ lineId: 'l2', lineNumber: 'REQ-20260913-001-02', rawMaterialId: 'rm-sugar', itemName: 'White Sugar', unit: 'g' });
    const verdicts = plan([
      row(2, { lineNumber: 'REQ-20260913-001-01', packs: '2' }),
      row(3, { lineNumber: 'REQ-20260913-001-01', item: 'White Sugar', packs: '1', packSize: '1000', pricePerPack: '80' }),
      row(4, { lineNumber: 'REQ-20260913-009-01', item: 'White Sugar', packs: '1', packSize: '1000', pricePerPack: '80' }),
    ]);
    expect(verdicts.map((v) => [v.rowNumber, v.kind, reason(v)])).toEqual([
      [2, 'REFUSED', 'Fill in packs, pack size and price per pack together.'],
      [3, 'REFUSED', 'Line REQ-20260913-001-01 is on row 2 too. Keep one row per line.'],
      [4, 'REFUSED', 'No line REQ-20260913-009-01 in this shop. Leave Line No. blank to add a purchase.'],
    ]);
    expect(reason(plan([row(5, { lineNumber: 'REQ-20260913-001-01', item: 'White Sugar', packs: '1', packSize: '1000', pricePerPack: '80' })])[0]))
      .toBe('Line REQ-20260913-001-01 is Full Cream Milk. To buy something else, use an empty row.');
    const days = plan([
      row(6, { lineNumber: 'REQ-20260913-001-01', packs: '1', packSize: '1000', pricePerPack: '90', boughtOn: '2026-09-11' }),
      row(7, { lineNumber: 'REQ-20260913-001-02', packs: '1', packSize: '1000', pricePerPack: '80', boughtOn: '2026-09-12' }),
    ], { lines: [line(), second] });
    expect(days.map((v) => [v.kind, reason(v)])).toEqual([
      ['FILL', undefined],
      ['REFUSED', 'REQ-20260913-001 has Bought on 2026-09-11 on row 6. One bought-on date per request.'],
    ]);
  });

  // ── purchases on no request ───────────────────────────────────────────────

  const NEW_ROW = { item: 'white sugar', boughtOn: '2026-09-12', packs: '2', packSize: '1', packUnit: 'kg', pricePerPack: '80', brand: 'S&R' };

  it('adds a purchase that is on no request, matched to the active ingredient and the branch', () => {
    // An old switched-off "White Sugar" does not make the active one ambiguous.
    const [v] = plan([row(9, { ...NEW_ROW, rowKey: 'aabbccddeeff' })]);
    expect(v).toEqual({
      kind: 'NEW', rowNumber: 9, item: 'White Sugar', unit: 'g', branchId: 'b1', branchName: 'Main', rawMaterialId: 'rm-sugar',
      boughtOn: '2026-09-12', packsBought: 2, packSize: 1000, packCost: 80, brandNote: 'S&R', rowKey: 'aabbccddeeff',
      sourceKind: null, sourceName: null,
    });
    expect(plan([row(9, { ...NEW_ROW, boughtAt: 'Palengke', store: '' })])[0]).toMatchObject({ kind: 'NEW', sourceKind: 'MARKET', sourceName: null });
  });

  it('refuses a new purchase it cannot place, in words that say what to fix', () => {
    const base = { boughtOn: '2026-09-12', packs: '1', packSize: '1000', packUnit: 'g', pricePerPack: '80' };
    const cases: Array<[Partial<SheetRow>, string]> = [
      [{ item: 'Oat Milk' }, 'No ingredient called "Oat Milk". Pick one from the list (the Items sheet), exactly as spelled.'],
      [{ item: 'salt' }, 'More than one ingredient is called "salt" apart from capital letters. Rename one in Clerque first.'],
      [{ item: 'Old Syrup' }, 'Old Syrup is switched off in Clerque.'],
      [{ item: 'Teriyaki Sauce (ready)' }, 'Teriyaki Sauce (ready) is made in the kitchen, not bought. Record it on the prep board.'],
      [{ item: 'White Sugar', boughtOn: '' }, 'When was it bought? Fill in Bought on (YYYY-MM-DD).'],
      [{ item: 'White Sugar', boughtOn: '2026-09-20' }, 'Bought on is in the future.'],
      [{ item: 'White Sugar', boughtOn: '13/09/2026' }, 'Bought on has to be a date (YYYY-MM-DD).'],
      [{ item: 'White Sugar', packUnit: 'bottle' }, 'Pack size has to be in g or kg ("bottle" cannot be converted).'],
      [{ item: 'White Sugar', packUnit: '' }, 'Pack unit: what is the pack size in (g or kg)?'],
      [{ item: 'White Sugar', pricePerPack: '0' }, 'Packs, pack size and price per pack all have to be more than zero.'],
      [{ item: 'White Sugar', branch: 'Naga' }, 'No branch called "Naga".'],
      [{ item: '' }, 'Which item? Pick one from the list in the Item column.'],
    ];
    for (const [over, why] of cases) {
      expect(plan([row(7, { ...base, ...over })])[0]).toMatchObject({ kind: 'REFUSED', rowNumber: 7, reason: why });
    }
    expect(reason(plan([row(7, { ...base, item: 'White Sugar' })], { canAddNew: false })[0])).toMatch(/Only the owner or a manager/);
    expect(reason(plan([row(7, { ...base, item: 'White Sugar' })], { branches: [MAIN, { id: 'b2', name: 'Naga' }] })[0])).toBe('Which branch? Fill in Branch.');
  });

  it('the same ingredient twice on one day at one branch is refused, naming the first row; a copied row is refused too', () => {
    const r = { ...NEW_ROW, item: 'White Sugar' };
    const twice = plan([row(4, r), row(6, { ...r, pricePerPack: '82' })]);
    expect(twice.map((v) => v.kind)).toEqual(['NEW', 'REFUSED']);
    expect(reason(twice[1])).toBe('White Sugar bought on 2026-09-12 is on row 4 too. Put both on one row (add up the packs).');
    const copied = plan([row(4, { ...r, rowKey: 'aabbccddeeff' }), row(5, { ...r, rowKey: 'aabbccddeeff', boughtOn: '2026-09-11' })]);
    expect(reason(copied[1])).toBe('This row was copied from row 4. Use an empty row for another purchase.');
  });

  const sheetLine = (over: Partial<ExistingLine> = {}) => line({
    lineId: 'l9', lineNumber: 'REQ-20260914-002-01', requestId: 'r9', requestNumber: 'REQ-20260914-002', requestStatus: 'BOUGHT', fromSheet: true,
    rawMaterialId: 'rm-sugar', itemName: 'White Sugar', unit: 'g', packsBought: 2, packSize: 1000, packCost: 85, brandNote: 'S&R', boughtOn: '2026-09-12', ...over,
  });

  it('uploading again after fixing packs or price corrects the earlier purchase instead of recording it twice', () => {
    const r = { ...NEW_ROW, item: 'White Sugar', pricePerPack: '58' };
    expect(plan([row(4, r)], { lines: [sheetLine()] })[0]).toMatchObject({ kind: 'FILL', lineId: 'l9', packCost: 58, brandNote: 'S&R' });
    expect(plan([row(4, { ...r, pricePerPack: '85' })], { lines: [sheetLine()] })[0].kind).toBe('UNCHANGED');
    // A blank Brand keeps the brand recorded in the app.
    expect(plan([row(4, { ...r, brand: '' })], { lines: [sheetLine()] })[0]).toMatchObject({ kind: 'FILL', brandNote: 'S&R' });
    // Only the store typed in afterwards: that alone corrects the purchase.
    expect(plan([row(4, { ...r, pricePerPack: '85', store: 'S&R Nuvali' })], { lines: [sheetLine()] })[0]).toMatchObject({ kind: 'FILL', sourceName: 'S&R Nuvali' });
    expect(plan([row(4, { ...r, pricePerPack: '85', store: 'S&R Nuvali' })], { lines: [sheetLine({ sourceName: 'S&R Nuvali' })] })[0].kind).toBe('UNCHANGED');
  });

  it('an earlier sheet purchase that was paid ahead, closed or put in stock since is not changed from the file', () => {
    const r = { ...NEW_ROW, item: 'White Sugar', pricePerPack: '58' };
    // Marked "ordered, paid from GCash" in the app after the upload: a price change would post a money correction.
    expect(reason(plan([row(4, r)], { lines: [sheetLine({ prepaid: true })] })[0])).toBe('Already recorded as REQ-20260914-002-01. REQ-20260914-002 was paid ahead, so a change there is a money correction. Change it on the request.');
    expect(reason(plan([row(4, r)], { lines: [sheetLine({ requestStatus: 'RECEIVED' })] })[0])).toMatch(/is closed/);
    expect(reason(plan([row(4, r)], { lines: [sheetLine({ receivedAt: new Date() })] })[0])).toMatch(/already in stock/);
    // A cancelled one is not "the earlier purchase" at all: the row is recorded afresh.
    expect(plan([row(4, r)], { lines: [sheetLine({ requestStatus: 'CANCELLED' })] })[0].kind).toBe('NEW');
  });

  it('a recorded row whose date, branch or item was then fixed in the file is refused, not recorded a second time', () => {
    // Recorded from this row as bought 2026-09-11 (a typo); the file now says 2026-09-12.
    const recorded = sheetLine({ sheetRowKey: 'aabbccddeeff', boughtOn: '2026-09-11' });
    const [v] = plan([row(4, { ...NEW_ROW, item: 'White Sugar', rowKey: 'aabbccddeeff' })], { lines: [recorded] });
    expect(reason(v)).toBe('Already recorded as REQ-20260914-002-01: White Sugar at Main, bought 2026-09-11. To change the item, branch or date, cancel REQ-20260914-002 in Clerque, then upload again.');
    // Same key, same date/branch/item, new price: corrects it.
    expect(plan([row(4, { ...NEW_ROW, item: 'White Sugar', boughtOn: '2026-09-11', pricePerPack: '60', rowKey: 'aabbccddeeff' })], { lines: [recorded] })[0])
      .toMatchObject({ kind: 'FILL', lineId: 'l9', packCost: 60 });
  });

  it('one line filled from two rows is refused on the second', () => {
    // The line is in the fresh download with its Line No., and the original blank row was pasted in too.
    const verdicts = plan([
      row(4, { lineNumber: 'REQ-20260914-002-01', packs: '2', packSize: '1000', pricePerPack: '60' }),
      row(5, { ...NEW_ROW, item: 'White Sugar', pricePerPack: '58' }),
    ], { lines: [sheetLine()] });
    expect(verdicts.map((v) => [v.kind, reason(v)])).toEqual([
      ['FILL', undefined],
      ['REFUSED', 'REQ-20260914-002-01 (White Sugar) is filled on row 4 too. Keep one row per purchase.'],
    ]);
  });

  it('skips blank rows, even with the branch filled in for you', () => {
    expect(plan([row(2), row(3, { branch: 'Main', brand: ' ' })])).toEqual([]);
  });
});
