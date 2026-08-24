import { ImportService } from './import.service';

/**
 * Re-importing a spreadsheet must never destroy work done in the app.
 *
 * A shop imports once, then spends days filling in costs, VAT flags and
 * contact details through the UI, then re-uploads a corrected sheet. Every
 * importer here rebuilt its update payload from the row wholesale, so a blank
 * cell — or a column the owner had deleted from the file — wrote a zero, a
 * false, or a null straight over what had been entered.
 *
 * The rule these tests pin: a blank cell means "I did not supply this", never
 * "set it to zero". A value that IS supplied still wins, so a genuine
 * correction still lands.
 */
describe('ImportService — re-import is non-destructive', () => {
  const TENANT = 't1';

  /** Captures what the importer would write to an EXISTING product. */
  function build(existingProduct: Record<string, unknown> | null = { id: 'p-1', name: 'Latte' }) {
    const updates: Array<Record<string, unknown>> = [];
    const creates: Array<Record<string, unknown>> = [];

    const prisma: any = {
      product: {
        findFirst: jest.fn().mockResolvedValue(existingProduct),
        update: jest.fn(({ data }: any) => { updates.push(data); return Promise.resolve({ id: 'p-1' }); }),
        create: jest.fn(({ data }: any) => { creates.push(data); return Promise.resolve({ id: 'p-new' }); }),
      },
      category: {
        findFirst: jest.fn().mockResolvedValue({ id: 'cat-1' }),
        create: jest.fn().mockResolvedValue({ id: 'cat-1' }),
      },
      branch: { findFirst: jest.fn().mockResolvedValue({ id: 'br-1' }) },
      inventoryItem: { upsert: jest.fn().mockResolvedValue({}) },
      productLot: { upsert: jest.fn().mockResolvedValue({}) },
    };

    const svc = new ImportService(prisma);
    const run = (rows: string[][]) =>
      (svc as unknown as {
        importProductsFromRows(r: string[][], t: string): Promise<unknown>;
      }).importProductsFromRows(rows, TENANT);

    return { run, updates, creates, prisma };
  }

  /** The lean 9-column template a cafe actually gets. */
  const LEAN_HEADER = [
    'Name*', 'Category', 'Price*', 'Cost Price', 'VAT (Y/N)', 'Barcode',
    'Description', 'Opening Stock', 'Low Stock Alert',
  ];

  it('does NOT zero the cost price when the Cost Price cell is blank', async () => {
    const { run, updates } = build();
    await run([LEAN_HEADER, ['Latte', 'Coffee', '139', '', '', '', '', '', '']]);

    expect(updates).toHaveLength(1);
    // The killer: `costPrice: 0` must not appear at all.
    expect(updates[0]).not.toHaveProperty('costPrice');
    expect(updates[0].price).toBe(139);
  });

  it('still updates the cost price when a real number is supplied', async () => {
    const { run, updates } = build();
    await run([LEAN_HEADER, ['Latte', 'Coffee', '139', '62.50', '', '', '', '', '']]);

    expect(Number(updates[0].costPrice)).toBeCloseTo(62.5, 2);
  });

  it('does NOT un-VAT a product when the VAT column is missing entirely', async () => {
    // A VAT-registered shop whose sheet has no VAT column had its whole
    // catalogue silently flipped to non-VATable — a BIR problem, not just data.
    const noVatHeader = ['Name*', 'Category', 'Price*', 'Cost Price'];
    const { run, updates } = build();
    await run([noVatHeader, ['Latte', 'Coffee', '139', '60']]);

    expect(updates[0]).not.toHaveProperty('isVatable');
  });

  it('does NOT un-VAT a product when the VAT cell is blank', async () => {
    const { run, updates } = build();
    await run([LEAN_HEADER, ['Latte', 'Coffee', '139', '60', '', '', '', '', '']]);

    expect(updates[0]).not.toHaveProperty('isVatable');
  });

  it('honours an explicit VAT value', async () => {
    const { run, updates } = build();
    await run([LEAN_HEADER, ['Latte', 'Coffee', '139', '60', 'N', '', '', '', '']]);

    expect(updates[0].isVatable).toBe(false);
  });

  it('never writes Opening Stock into the pharmacy generic-name field', async () => {
    // On the lean template, positional destructuring put column 8 (Opening
    // Stock) into genericName — a cafe got products whose generic name was "50".
    const { run, updates } = build();
    await run([LEAN_HEADER, ['Latte', 'Coffee', '139', '60', 'Y', '', '', '50', '10']]);

    expect(updates[0]).not.toHaveProperty('genericName');
    expect(updates[0]).not.toHaveProperty('brandName');
  });

  it('leaves inventoryMode and isActive alone, so recipes set in the app survive', async () => {
    const { run, updates } = build();
    await run([LEAN_HEADER, ['Latte', 'Coffee', '139', '60', 'Y', '', '', '', '']]);

    // A product switched to RECIPE_BASED in the app must not be reset.
    expect(updates[0]).not.toHaveProperty('inventoryMode');
    expect(updates[0]).not.toHaveProperty('isActive');
    expect(updates[0]).not.toHaveProperty('name');
  });

  it('sets opening stock absolutely, so a second import does not double it', async () => {
    const { run, prisma } = build();
    await run([LEAN_HEADER, ['Latte', 'Coffee', '139', '60', 'Y', '', '', '25', '']]);

    const call = prisma.inventoryItem.upsert.mock.calls[0][0];
    expect(Number(call.update.quantity)).toBe(25);      // SET
    expect(call.update.quantity).not.toHaveProperty('increment');
  });
});

/**
 * The same rule for the records an owner curates by hand after go-live.
 */
describe('ImportService — blank cells never null a stored value', () => {
  const svc = new ImportService({} as any);
  const strip = (o: Record<string, unknown>) =>
    (svc as unknown as { onlySupplied(d: Record<string, unknown>): Record<string, unknown> })
      .onlySupplied(o);

  it('drops nulls so a names-only customer file keeps TIN and address', async () => {
    const out = strip({
      name: 'Reyes Catering',
      tin: null,           // blank in the re-uploaded sheet
      address: null,
      creditTermDays: 0,   // a real zero, must survive
      isActive: true,
    });

    expect(out).not.toHaveProperty('tin');
    expect(out).not.toHaveProperty('address');
    expect(out.name).toBe('Reyes Catering');
    // 0 is a value, not an absence — it must not be stripped.
    expect(out.creditTermDays).toBe(0);
  });

  it('keeps false, which is a value too', async () => {
    const out = strip({ name: 'X', isActive: false });
    expect(out.isActive).toBe(false);
  });
});
