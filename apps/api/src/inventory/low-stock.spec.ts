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

  /** A ticket line waiting at a kitchen or bar screen, and the order it belongs to. */
  type Ticket = { branchId: string; status: string; productId: string; quantity: number };

  function build(opts: { products?: any[]; ingredients?: any[]; vendors?: any[]; tickets?: Ticket[]; recipes?: any[] } = {}) {
    const prisma: any = {
      /*
        Waiting lines, filtered the way the database would: by the order's
        status and branch as heldUsage asks for them. A spec that got the
        branch or the status wrong in the query would see the wrong ticket.
      */
      orderItem: {
        findMany: jest.fn(({ where }: any) => Promise.resolve((opts.tickets ?? [])
          .filter(() => where.usageOnReady === true && where.usagePostedAt === null)
          .filter((t) => where.order.tenantId === TENANT && where.order.status.in.includes(t.status))
          .filter((t) => !where.order.branchId || where.order.branchId.in.includes(t.branchId))
          .map((t) => ({
            productId: t.productId, variantId: null, quantity: t.quantity, refundedQty: 0,
            modifiers: [], order: { branchId: t.branchId },
          })))),
      },
      bomItem: {
        findMany: jest.fn(({ where }: any) => Promise.resolve(
          (opts.recipes ?? []).filter((b: any) => where.productId.in.includes(b.productId)))),
      },
      variantBomItem: { findMany: jest.fn().mockResolvedValue([]) },
      modifierOption: { findMany: jest.fn().mockResolvedValue([]) },
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
            /*
              Whether the shop MAKES this or BUYS it. Having a recipe is what
              decides it, and a prep that is low needs a batch rather than a
              trip to the market -- so the two go on different lists. Empty
              unless a case says otherwise: these fixtures are bought goods.
            */
            subRecipeItems: r.rawMaterial?.subRecipeItems ?? [],
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

  // ── tickets waiting at the kitchen or bar hold their ingredients ─────────

  /*
    A latte waiting at the bar screen has not taken its milk off the books yet;
    it takes it when marked ready. Until then the milk is on the shelf but
    promised, and a buying decision made on the shelf figure is made too late.
  */
  const LATTE = [{ productId: 'latte', rawMaterialId: 'rm2', quantity: '200', rawMaterial: null }];
  const milkOnShelf = {
    quantity: '5400',
    rawMaterial: { id: 'rm2', name: 'Fresh Milk', unit: 'ml', lowStockAlert: '5000' },
  };

  it('a ticket waiting at this branch lowers what is available, and says how much it holds', async () => {
    const { svc } = build({
      ingredients: [milkOnShelf], recipes: LATTE,
      tickets: [{ branchId: BRANCH, status: 'PAID', productId: 'latte', quantity: 4 }],
    });
    const out = await svc.getLowStock(TENANT, BRANCH);

    // 5400 on the shelf, 800 promised to four lattes: 4600 left, 400 under the line.
    expect(out).toHaveLength(1);
    expect(out[0].quantity).toBe(4600);
    expect(out[0].heldQty).toBe(800);
    expect(out[0].shortBy).toBe(400);
  });

  it('a ticket at another branch, or on a voided order, holds nothing here', async () => {
    const { svc } = build({
      ingredients: [milkOnShelf], recipes: LATTE,
      tickets: [
        { branchId: 'b2', status: 'PAID', productId: 'latte', quantity: 4 },
        { branchId: BRANCH, status: 'VOIDED', productId: 'latte', quantity: 4 },
      ],
    });
    // 5400 is above 5000 once nothing here is held.
    expect(await svc.getLowStock(TENANT, BRANCH)).toEqual([]);
  });

  it('with nothing waiting, the figures are the shelf figures', async () => {
    const { svc } = build({ ingredients: [beans], recipes: LATTE });
    const out = await svc.getLowStock(TENANT, BRANCH);
    expect(out[0].quantity).toBe(1500);
    expect(out[0].heldQty).toBe(0);
    expect(out[0].shortBy).toBe(500);
  });

  it('the slip says where the rest of the shelf is going, within the roll', async () => {
    const { svc } = build({
      ingredients: [milkOnShelf], recipes: LATTE,
      tickets: [{ branchId: BRANCH, status: 'COMPLETED', productId: 'latte', quantity: 4 }],
    });
    const { text, count } = await svc.lowStockSlip(TENANT, BRANCH);
    expect(count).toBe(1);
    expect(text).toContain('have 4600 ml');
    expect(text).toContain('800 ml held for orders');
    expect(text).toContain('SHORT 400 ml');
    for (const line of text.split('\n')) expect(line.length).toBeLessThanOrEqual(32);
  });

  it('the slip adds no held line when nothing is waiting', async () => {
    const { svc } = build({ ingredients: [milk] });
    const { text } = await svc.lowStockSlip(TENANT, BRANCH);
    expect(text).not.toContain('held for orders');
  });

  // Stock on hand: the shelf figure stays, what is held is said beside it.

  it('Stock on hand keeps the shelf figure, adds what waiting tickets hold, and judges low on the rest', async () => {
    const { svc } = build({
      ingredients: [milkOnShelf], recipes: LATTE,
      tickets: [{ branchId: BRANCH, status: 'PAID', productId: 'latte', quantity: 4 }],
    });
    const [row] = await svc.listRawMaterials(TENANT, false, BRANCH);

    // Counts and write-offs are checked against stockQty, so it is what is physically there.
    expect(row.stockQty).toBe(5400);
    expect(row.heldQty).toBe(800);
    expect(row.availableQty).toBe(4600);
    expect(row.isLowStock).toBe(true);
  });

  it('Stock on hand holds nothing for a ticket at another branch or on a voided order', async () => {
    const { svc } = build({
      ingredients: [milkOnShelf], recipes: LATTE,
      tickets: [
        { branchId: 'b2', status: 'PAID', productId: 'latte', quantity: 4 },
        { branchId: BRANCH, status: 'VOIDED', productId: 'latte', quantity: 4 },
      ],
    });
    const [row] = await svc.listRawMaterials(TENANT, false, BRANCH);
    expect(row.stockQty).toBe(5400);
    expect(row.heldQty).toBe(0);
    expect(row.availableQty).toBe(5400);
    expect(row.isLowStock).toBe(false);
  });

  it('Stock on hand is unchanged when nothing is waiting', async () => {
    const { svc } = build({ ingredients: [beans, plenty], recipes: LATTE });
    const rows = await svc.listRawMaterials(TENANT, false, BRANCH);
    expect(rows.map((r: any) => [r.stockQty, r.heldQty, r.availableQty, r.isLowStock]))
      .toEqual([[1500, 0, 1500, true], [9000, 0, 9000, false]]);
  });

  it('the ingredient library without a branch asks nothing about tickets', async () => {
    const { svc, prisma } = build({ ingredients: [milkOnShelf], recipes: LATTE });
    const [row] = await svc.listRawMaterials(TENANT, false);
    expect(prisma.orderItem.findMany).not.toHaveBeenCalled();
    expect(row).not.toHaveProperty('heldQty');
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
      'Item', 'Unit', 'On hand', 'Reorder level', 'SHORT BY',
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

  it('keeps what the kitchen makes off the shopping slip and the Buy Now sheet', async () => {
    // A sauce short of its par needs a batch, not a trip to the market; the prep board and its alerts say that.
    const sauce = {
      quantity: '100',
      rawMaterial: { id: 'rm-sauce', name: 'Teriyaki Sauce', unit: 'ml', lowStockAlert: '400', subRecipeItems: [{ id: 'x' }] },
    };
    const { svc } = build({ ingredients: [beans, sauce] });
    const { text, count } = await svc.lowStockSlip(TENANT, BRANCH);
    expect(count).toBe(1);
    expect(text).toContain('Coffee Beans');
    expect(text).not.toContain('Teriyaki');
    const ws = await sheetOf(await svc.lowStockExport(TENANT, BRANCH));
    const names: string[] = [];
    ws.eachRow((row: any) => names.push(String(row.getCell(1).value ?? '')));
    expect(names).toContain('Coffee Beans');
    expect(names.some((n) => n.includes('Teriyaki'))).toBe(false);
  });

  it('when only kitchen preps are low, the slip says nothing to buy rather than nothing is low', async () => {
    const sauce = {
      quantity: '0',
      rawMaterial: { id: 'rm-sauce', name: 'Teriyaki Sauce', unit: 'ml', lowStockAlert: '400', subRecipeItems: [{ id: 'x' }] },
    };
    const { svc } = build({ ingredients: [plenty, sauce] });
    const { text, count } = await svc.lowStockSlip(TENANT, BRANCH);
    expect(count).toBe(0);
    expect(text).toContain('Nothing to buy right now.');
    expect(text).toContain('1 kitchen prep is low:');
    expect(text).not.toContain('Nothing is below');
    for (const line of text.split('\n')) expect(line.length).toBeLessThanOrEqual(32);
    const ws = await sheetOf(await svc.lowStockExport(TENANT, BRANCH));
    expect(String(ws.getCell(2, 1).value)).toBe('Nothing to buy right now. 1 kitchen prep is low too: see the prep board.');
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
