import { ReportsService } from './reports.service';
import { generateRecipeCostingPdf, RecipeCostItem } from './recipe-costing-pdf';

/**
 * The whole point of this report is that it must not flatter the menu.
 *
 * An ingredient with no price contributes nothing to COGS, so a drink missing
 * one reads as CHEAPER to make and therefore MORE profitable — it sorts to the
 * top of any margin ranking. Cafe Carolina hit this for real: Dark Chocolate
 * Latte, Salted Caramel and Spanish Latte all showed 76% (the best on the
 * menu) purely because their expensive ingredient had no cost yet, and all
 * three came out to an identical COGS because in the data they were the same
 * drink: milk, coffee, ice, cup, lid.
 *
 * So a missing price must withhold the margin, never produce one.
 */
describe('ReportsService — recipe costing', () => {
  function build(products: any[]) {
    const prisma: any = { product: { findMany: jest.fn().mockResolvedValue(products) } };
    return new ReportsService(prisma) as any;
  }
  const rm = (name: string, unit: string, cost: number | null) => ({
    rawMaterial: { name, unit, costPrice: cost },
  });
  const line = (name: string, unit: string, cost: number | null, qty: number) => ({
    quantity: qty, ...rm(name, unit, cost),
  });

  it('costs a fully priced drink and reports its margin', async () => {
    const svc = build([{
      name: 'Cafe Latte ( Hot )', price: 120, category: { name: 'Espresso' },
      bomItems: [line('Coffee Beans', 'g', 1.1, 17), line('Full Cream Milk', 'ml', 0.09, 200)],
    }]);
    const [item] = await svc.recipeCostingReport('t1');

    expect(item.cost).toBeCloseTo(17 * 1.1 + 200 * 0.09, 4);   // 36.70
    expect(item.margin).toBeCloseTo((120 - 36.7) / 120, 4);     // 69%
    expect(item.unpriced).toEqual([]);
  });

  it('withholds the margin when a line has no price, instead of inflating it', async () => {
    const svc = build([{
      name: 'Hojicha Milk ( Hot )', price: 200, category: null,
      bomItems: [line('Full Cream Milk', 'ml', 0.09, 200), line('Hojicha Powder', 'g', null, 4)],
    }]);
    const [item] = await svc.recipeCostingReport('t1');

    expect(item.margin).toBeNull();
    expect(item.unpriced).toEqual(['Hojicha Powder']);
    // the priced line still shows, so the reader can see what IS known
    expect(item.cost).toBeCloseTo(18, 4);
  });

  it('treats a stored cost of zero as "no price", not as free', async () => {
    // Clerque writes 0 rather than null when an import leaves the cell blank
    // on a brand-new ingredient, so zero is the shape this actually arrives in.
    const svc = build([{
      name: 'Vietnamese Latte', price: 149, category: null,
      bomItems: [line('Longgo Espresso Shot', 'ml', 0, 70)],
    }]);
    const [item] = await svc.recipeCostingReport('t1');

    expect(item.margin).toBeNull();
    expect(item.unpriced).toEqual(['Longgo Espresso Shot']);
    expect(item.lines[0].unitCost).toBeNull();
    expect(item.lines[0].lineCost).toBe(0);
  });

  it('names every unpriced ingredient, not just the first', async () => {
    const svc = build([{
      name: 'Minasa Yogurt', price: 159, category: null,
      bomItems: [
        line('Minasa Biscuits', 'pc', null, 5),
        line('Sea Salt Cream', 'ml', null, 15),
        line('Yogurt', 'ml', 0.34, 100),
      ],
    }]);
    const [item] = await svc.recipeCostingReport('t1');
    expect(item.unpriced).toEqual(['Minasa Biscuits', 'Sea Salt Cream']);
  });

  it('asks only for products that actually have a recipe', async () => {
    const prisma: any = { product: { findMany: jest.fn().mockResolvedValue([]) } };
    await (new ReportsService(prisma) as any).recipeCostingReport('t1');
    const where = prisma.product.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ tenantId: 't1', isActive: true, bomItems: { some: {} } });
  });

  it('refuses a margin on a zero-priced product rather than dividing by zero', async () => {
    const svc = build([{
      name: 'Staff Drink', price: 0, category: null,
      bomItems: [line('Coffee Beans', 'g', 1.1, 17)],
    }]);
    const [item] = await svc.recipeCostingReport('t1');
    expect(item.margin).toBeNull();
    expect(Number.isFinite(item.cost)).toBe(true);
  });
});

describe('recipe costing PDF', () => {
  const items: RecipeCostItem[] = [
    {
      product: 'Long Black ( Hot )', category: 'Espresso', price: 80, cost: 62,
      margin: 0.225, unpriced: [],
      lines: [
        { ingredient: 'Coffee Beans', quantity: 50, unit: 'g',  unitCost: 1.1,  lineCost: 55 },
        { ingredient: 'Hot Cup 12oz', quantity: 1,  unit: 'pc', unitCost: 5,    lineCost: 5 },
      ],
    },
    {
      product: 'Hojicha Milk ( Hot )', category: null, price: 200, cost: 18,
      margin: null, unpriced: ['Hojicha Powder'],
      lines: [
        { ingredient: 'Full Cream Milk', quantity: 200, unit: 'ml', unitCost: 0.09, lineCost: 18 },
        { ingredient: 'Hojicha Powder',  quantity: 4,   unit: 'g',  unitCost: null, lineCost: 0 },
      ],
    },
  ];

  it('renders a real PDF', async () => {
    const buf = await generateRecipeCostingPdf({
      tenant: { name: 'Cafe Carolina', businessName: 'Cafe Carolina' },
      generatedAt: '29 Aug 2026, 9:44 AM',
      generatedBy: 'KJ',
      items,
    });
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buf.length).toBeGreaterThan(2000);
  });

  it('never puts the peso sign on the page', async () => {
    // U+20B1 is not in Helvetica's WinAnsi encoding — pdfkit measures it at
    // zero width and it silently disappears, which is how the invoice and
    // payslip PDFs lost theirs. Amounts are labelled PHP instead.
    const buf = await generateRecipeCostingPdf({
      tenant: { name: 'Cafe Carolina', businessName: null },
      generatedAt: 'x', generatedBy: 'y', items,
    });
    expect(buf.toString('latin1')).not.toContain('₱');
  });

  it('survives an empty menu without dividing by zero', async () => {
    const buf = await generateRecipeCostingPdf({
      tenant: { name: 'New Shop', businessName: null },
      generatedAt: 'x', generatedBy: 'y', items: [],
    });
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
  });
});
