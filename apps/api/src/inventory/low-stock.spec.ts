import { InventoryService } from './inventory.service';

/**
 * "What am I running out of?" — asked by a cashier, mid-shift.
 *
 * The endpoint has always been open to CASHIER, but it only ever queried
 * finished goods, so a café got bottled water and packaged snacks back and not
 * one ingredient. Ingredient stock lives in `rawMaterialInventory` against
 * `RawMaterial.lowStockAlert`, and for a recipe-based shop that is the whole
 * point of the question.
 *
 * It also spread the raw InventoryItem row into the response, which put
 * `avgCost` — the shop's buying price — in front of every cashier.
 */
describe('InventoryService — low stock covers ingredients, and leaks nothing', () => {
  const TENANT = 't1';
  const BRANCH = 'b1';

  function build(opts: { products?: any[]; ingredients?: any[]; vendors?: any[] } = {}) {
    const prisma: any = {
      inventoryItem: {
        findMany: jest.fn().mockResolvedValue(opts.products ?? []),
      },
      rawMaterialInventory: {
        findMany: jest.fn().mockResolvedValue(opts.ingredients ?? []),
      },
      vendor: { findMany: jest.fn().mockResolvedValue(opts.vendors ?? []) },
      branch: { findUnique: jest.fn().mockResolvedValue({ name: 'Main Branch' }) },
      /*
        getLowStock reads RAW MATERIALS with their branch stock attached, not
        inventory rows — an ingredient never yet received at this branch has no
        inventory row, and reading only rows that exist told an empty stockroom
        it was fine. The fixtures below stay in the old shape because they read
        well; this reshapes them into what the query returns.
      */
      rawMaterial: {
        findMany: jest.fn().mockResolvedValue(
          (opts.ingredients ?? []).map((r: any) => ({
            ...r.rawMaterial,
            inventory: r.quantity == null ? [] : [{ quantity: r.quantity }],
          }))),
      },
    };
    // getLowStock is a pure read and never reaches the period service
    const periods: any = {};
    return { svc: new InventoryService(prisma, periods) as any, prisma };
  }

  const beans = {
    quantity: '1500',
    rawMaterial: { id: 'rm1', name: 'Coffee Beans', unit: 'g', lowStockAlert: '2000' },
  };
  const milk = {
    quantity: '400',
    rawMaterial: { id: 'rm2', name: 'Fresh Milk', unit: 'ml', lowStockAlert: '5000' },
  };
  const plenty = {
    quantity: '9000',
    rawMaterial: { id: 'rm3', name: 'White Sugar', unit: 'g', lowStockAlert: '1000' },
  };
  const noThreshold = {
    quantity: '5',
    rawMaterial: { id: 'rm4', name: 'Agave Syrup', unit: 'g', lowStockAlert: null },
  };

  it('returns ingredients that are at or below their threshold', async () => {
    const { svc } = build({ ingredients: [beans, milk, plenty] });
    const out = await svc.getLowStock(TENANT, BRANCH);

    expect(out.map((r: any) => r.name)).toEqual(['Fresh Milk', 'Coffee Beans']);
    expect(out.every((r: any) => r.kind === 'INGREDIENT')).toBe(true);
  });

  it('ignores an ingredient with no threshold set', async () => {
    // No threshold is not the same as "fine" — but alerting on it would bury
    // the real ones, and every uncosted new ingredient starts out this way.
    const { svc } = build({ ingredients: [noThreshold] });
    expect(await svc.getLowStock(TENANT, BRANCH)).toEqual([]);
  });

  it('sorts worst-first, because the reader is deciding what to buy', async () => {
    const { svc } = build({ ingredients: [beans, milk] });
    const out = await svc.getLowStock(TENANT, BRANCH);

    expect(out[0].name).toBe('Fresh Milk');      // 4600 short
    expect(out[0].shortBy).toBe(4600);
    expect(out[1].shortBy).toBe(500);            // beans
  });

  it('still returns low products, alongside the ingredients', async () => {
    const { svc } = build({
      products: [{
        quantity: '3', lowStockAlert: '10',
        product: { id: 'p1', name: 'Bottled Water', sku: 'BW1' },
      }],
      ingredients: [beans],
    });
    const out = await svc.getLowStock(TENANT, BRANCH);

    expect(out.map((r: any) => [r.kind, r.name]))
      .toEqual([['INGREDIENT', 'Coffee Beans'], ['PRODUCT', 'Bottled Water']]);
  });

  it('never returns a cost field — a cashier can read this', async () => {
    const { svc } = build({
      products: [{
        quantity: '3', lowStockAlert: '10', avgCost: '42.50',
        product: { id: 'p1', name: 'Bottled Water', sku: 'BW1' },
      }],
      ingredients: [beans],
    });
    const out = await svc.getLowStock(TENANT, BRANCH);

    for (const row of out) {
      const keys = Object.keys(row).join(' ').toLowerCase();
      expect(keys).not.toContain('cost');
      expect(keys).not.toContain('price');
    }
    expect(JSON.stringify(out)).not.toContain('42.50');
  });

  it('scopes ingredients to the tenant, and their stock to the branch', async () => {
    const { svc, prisma } = build({ ingredients: [] });
    await svc.getLowStock(TENANT, BRANCH);

    const call = prisma.rawMaterial.findMany.mock.calls[0][0];
    expect(call.where.tenantId).toBe(TENANT);
    expect(call.where.isActive).toBe(true);
    // The stock join is what carries the branch — without it one shop would
    // read another branch's quantities.
    expect(call.select.inventory.where.branchId).toBe(BRANCH);
  });

  it('treats an ingredient with no stock row at all as zero, not as absent', async () => {
    /*
      The go-live case. A shop that has never received an ingredient has no
      RawMaterialInventory row for it, and reading only existing rows reported
      "nothing is below its reorder level" on an empty stockroom — while Check
      stock pulled nothing onto the buy list.
    */
    const neverReceived = {
      quantity: null,
      rawMaterial: { id: 'rm9', name: 'Vanilla Syrup', unit: 'ml', lowStockAlert: '500' },
    };
    const { svc } = build({ ingredients: [neverReceived] });
    const out = await svc.getLowStock(TENANT, BRANCH);

    expect(out.map((r: any) => r.name)).toEqual(['Vanilla Syrup']);
    expect(out[0].quantity).toBe(0);
    expect(out[0].shortBy).toBe(500);
  });

  // ── the printable version ────────────────────────────────────────────────

  async function sheetOf(buf: Buffer) {
    const ExcelJS = await import('exceljs');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as never);
    return wb.getWorksheet('Buy Now')!;
  }

  it('exports a sheet shaped like the expense report the shop already keeps', async () => {
    // The point is that one sheet is both the shopping list and the record of
    // what was bought — a second form is a form nobody fills in.
    const { svc } = build({ ingredients: [beans, milk] });
    const ws = await sheetOf(await svc.lowStockExport(TENANT, BRANCH));

    const header = (ws.getRow(5).values as unknown[]).slice(1).map(String);
    expect(header).toEqual([
      'Item', 'Unit', 'On hand', 'Alert at', 'SHORT BY',
      'Date bought', 'Store', 'Area', 'Pack size', 'Pack unit',
      'Qty (packs)', 'Unit price (₱)', 'Amount (₱)',
    ]);
  });

  it('lists the short items worst-first, with what the system knows', async () => {
    const { svc } = build({ ingredients: [beans, milk] });
    const ws = await sheetOf(await svc.lowStockExport(TENANT, BRANCH));

    expect(ws.getCell(6, 1).value).toBe('Fresh Milk');
    expect(ws.getCell(6, 5).value).toBe(4600);
    expect(ws.getCell(7, 1).value).toBe('Coffee Beans');
    expect(ws.getCell(7, 5).value).toBe(500);
  });

  it('totals what was spent, so the sheet closes itself out', async () => {
    const { svc } = build({ ingredients: [beans] });
    const ws = await sheetOf(await svc.lowStockExport(TENANT, BRANCH));

    let found = false;
    ws.eachRow((row) => {
      for (const cell of row.model?.cells ?? []) {
        const f = (cell as { formula?: string }).formula ?? '';
        if (f.startsWith('ROUND(SUM(M')) found = true;
      }
    });
    expect(found).toBe(true);
  });

  it('carries no prices out of the system — a cashier prints this', async () => {
    const { svc } = build({
      products: [{
        quantity: '3', lowStockAlert: '10', avgCost: '999.99',
        product: { id: 'p1', name: 'Bottled Water', sku: 'BW1' },
      }],
      ingredients: [beans],
    });
    const buf = await svc.lowStockExport(TENANT, BRANCH);
    expect(buf.toString('binary')).not.toContain('999.99');
  });

  it('still produces a usable sheet when nothing is low', async () => {
    // An empty list is a real answer, and the blank rows still let someone
    // write down what they bought anyway.
    const { svc } = build({ ingredients: [] });
    const ws = await sheetOf(await svc.lowStockExport(TENANT, BRANCH));

    expect(String(ws.getCell(2, 1).value)).toContain('Nothing is below');
    expect(ws.getCell(5, 1).value).toBe('Item');
  });

  // ── the slip: popup and thermal print, from one source ───────────────────

  it('renders a slip that fits a 32-character roll', async () => {
    const { svc } = build({ ingredients: [beans, milk] });
    const { text } = await svc.lowStockSlip(TENANT, BRANCH);

    for (const line of text.split('\n')) {
      expect(line.length).toBeLessThanOrEqual(32);
    }
  });

  it('separates what is OUT from what is merely low', async () => {
    // "we have none" and "we are getting low" are different instructions to
    // the person reading it, and burying one in the other loses the urgent one.
    const empty = {
      quantity: '0',
      rawMaterial: { id: 'rm9', name: 'Oatside', unit: 'ml', lowStockAlert: '3000' },
    };
    const { svc } = build({ ingredients: [beans, empty] });
    const { text, outCount, count } = await svc.lowStockSlip(TENANT, BRANCH);

    expect(outCount).toBe(1);
    expect(count).toBe(2);
    expect(text.indexOf('OUT OF STOCK')).toBeLessThan(text.indexOf('RUNNING LOW'));
    expect(text.indexOf('Oatside')).toBeLessThan(text.indexOf('Coffee Beans'));
  });

  it('tells the reader how much is missing, not just the level', async () => {
    const { svc } = build({ ingredients: [milk] });
    const { text } = await svc.lowStockSlip(TENANT, BRANCH);
    expect(text).toContain('SHORT 4600 ml');
  });

  it('says so plainly when nothing is low', async () => {
    const { svc } = build({ ingredients: [] });
    const { text, count } = await svc.lowStockSlip(TENANT, BRANCH);
    expect(count).toBe(0);
    expect(text).toContain('Nothing is below');
  });

  it('prints the same content it shows on screen', async () => {
    // One source, rendered twice — if these ever disagree the cashier has to
    // decide which to believe, which is worse than having neither.
    const { svc } = build({ ingredients: [beans, milk] });
    const { InlineEscPosBuilder } = require('../close-and-plan/inline-escpos');

    const { text } = await svc.lowStockSlip(TENANT, BRANCH);
    const bytes = await svc.lowStockEscPos(TENANT, BRANCH, InlineEscPosBuilder);
    const printed = Buffer.from(bytes).toString('latin1');

    for (const name of ['Coffee Beans', 'Fresh Milk', 'SHORT 4600 ml']) {
      expect(text).toContain(name);
      expect(printed).toContain(name);
    }
  });

  it('ends the print with a feed and a cut', async () => {
    const { svc } = build({ ingredients: [beans] });
    const { InlineEscPosBuilder } = require('../close-and-plan/inline-escpos');
    const bytes = await svc.lowStockEscPos(TENANT, BRANCH, InlineEscPosBuilder);

    // GS V 0 — without it the slip stays attached to the roll
    const tail = Array.from(bytes.slice(-3));
    expect(tail).toEqual([0x1d, 0x56, 0x00]);
  });
});
