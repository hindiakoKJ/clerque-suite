import { ImportService } from './import.service';

/**
 * Ingredients: buy in one unit, cook in another.
 *
 * A shop buys milk by the litre and pours it by the millilitre. Asking for a
 * single unit forces the owner to divide in his head before he types, and a
 * slip there is a 1000x cost error that nothing downstream questions — the
 * exact failure that put a ₱9.7M valuation on a café kitchen during the
 * Carolina onboarding.
 *
 * So the sheet takes both units plus, where the buying unit is a container,
 * the pack size that bridges them. Everything downstream still stores ONE
 * unit per ingredient — the recipe one — with the cost converted into it here.
 */
describe('ImportService — ingredient buy-unit vs recipe-unit', () => {
  const TENANT = 't1';
  const HEADER = ['Name*', 'Unit*', 'Cost per Unit (₱)*', 'Low Stock Alert', 'Notes',
                  'Recipe Unit', 'Pack Size'];

  function build() {
    const writes: any[] = [];
    const prisma: any = {
      rawMaterial: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(({ data }: any) => { writes.push(data); return Promise.resolve({ id: 'rm' }); }),
        update: jest.fn(({ data }: any) => { writes.push(data); return Promise.resolve({ id: 'rm' }); }),
      },
    };
    const svc = new ImportService(prisma);
    const run = (rows: string[][]) =>
      (svc as unknown as {
        importIngredientsFromRows(r: string[][], t: string): Promise<any>;
      }).importIngredientsFromRows([HEADER, ...rows], TENANT);
    return { run, writes };
  }

  it('converts a litre price into a per-millilitre cost', async () => {
    const { run, writes } = build();
    const res = await run([['Fresh Milk', 'L', '88', '', '', 'ml', '']]);

    expect(res.errors).toEqual([]);
    expect(writes[0].unit).toBe('ml');
    expect(Number(writes[0].costPrice)).toBeCloseTo(0.088, 6);
  });

  it('converts a kilo price into a per-gram cost', async () => {
    const { run, writes } = build();
    await run([['Coffee Beans', 'kg', '1100', '', '', 'g', '']]);

    expect(writes[0].unit).toBe('g');
    expect(Number(writes[0].costPrice)).toBeCloseTo(1.1, 6);
  });

  it('uses the pack size when the buying unit is a container', async () => {
    // A carton is not a quantity until the sheet says how big it is.
    const { run, writes } = build();
    await run([['Oat Milk', 'carton', '95', '', '', 'ml', '1000']]);

    expect(writes[0].unit).toBe('ml');
    expect(Number(writes[0].costPrice)).toBeCloseTo(0.095, 6);
  });

  it('leaves a single-unit row exactly as before', async () => {
    const { run, writes } = build();
    await run([['Salt', 'g', '0.06', '', '', '', '']]);

    expect(writes[0].unit).toBe('g');
    expect(Number(writes[0].costPrice)).toBeCloseTo(0.06, 6);
  });

  it('still imports an old three-column sheet unchanged', async () => {
    // Backward compatibility is the whole reason these columns are optional.
    const { run, writes } = build();
    const res = await run([['Flour', 'kg', '48', '3', 'legacy row']] as string[][]);

    expect(res.errors).toEqual([]);
    expect(writes[0].unit).toBe('kg');
    expect(Number(writes[0].costPrice)).toBeCloseTo(48, 6);
  });

  it('refuses a container with no pack size rather than guessing one', async () => {
    const { run, writes } = build();
    const res = await run([['Syrup', 'bottle', '250', '', '', 'ml', '']]);

    expect(writes).toHaveLength(0);
    expect(res.errors[0].message).toContain('Add a Pack Size');
    expect(res.errors[0].message).toContain('how many ml are in one bottle');
  });

  it('refuses a pack size on units that already convert', async () => {
    // L -> ml is 1000 on its own; a pack size here would apply it twice.
    const { run, writes } = build();
    const res = await run([['Milk', 'L', '88', '', '', 'ml', '1000']]);

    expect(writes).toHaveLength(0);
    expect(res.errors[0].message).toContain('must be blank');
  });

  it('refuses to cross mass and volume', async () => {
    const { run, writes } = build();
    const res = await run([['Cream', 'kg', '300', '', '', 'ml', '']]);

    expect(writes).toHaveLength(0);
    expect(res.errors[0].message).toContain('Cannot get from');
  });
});
