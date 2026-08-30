import { ImportService } from './import.service';

/**
 * Opening stock loaded from the workbook has to be valued the same way a
 * delivery received in the app is.
 *
 * `receiveRawMaterial` divides a VAT-registered shop's delivery cost by 1.12,
 * so the shelf, the lot, the weighted average and the ledger all carry the
 * same net basis and the input tax is claimed once, where an invoice exists
 * (inventory.service.ts:1472). This path had no tax lookup at all.
 *
 * The result: the opening buy was capitalised GROSS, every later receive of
 * the same ingredient was NET, and the two got blended into one weighted
 * average. Recipe costs drifted by roughly 11% and the input tax on the
 * opening purchase was never claimed — silently, because the trial balance
 * still footed either way.
 *
 * OWNER_FUNDED is excluded on both paths for the same reason: stock the owner
 * carried in has no supplier and no invoice behind it, so claiming input tax
 * on it would fabricate a receivable from the BIR. It is also the DEFAULT when
 * the column is left blank, which is why this only ever bit the shop that
 * filled the sheet in honestly.
 */
describe('ImportService — stock receipts and recoverable input VAT', () => {
  const TENANT = 't1';
  const HEADER = ['Date* (YYYY-MM-DD)', 'Ingredient/Product Name*', 'Quantity*',
                  'Unit Cost*', 'Branch', 'Payment Method', 'Vendor', 'Reference Number'];

  function build(taxStatus: string) {
    const lots: any[] = [];
    const wac: any[] = [];
    const events: any[] = [];
    const prisma: any = {
      branch: { findFirst: jest.fn().mockResolvedValue({ id: 'b1', name: 'Main Branch' }) },
      tenant: { findUnique: jest.fn().mockResolvedValue({ taxStatus }) },
      rawMaterial: {
        findFirst: jest.fn(({ where }: any) =>
          Promise.resolve({ id: 'rm-1', name: where.name, unit: 'g', costPrice: null })),
        update: jest.fn((a: any) => { wac.push(a.data); return Promise.resolve({}); }),
        findMany: jest.fn(() => Promise.resolve([])),
      },
      bomItem: { findMany: jest.fn(() => Promise.resolve([])) },
      product: { findFirst: jest.fn().mockResolvedValue(null), update: jest.fn() },
      vendor: { findFirst: jest.fn().mockResolvedValue(null) },
      rawMaterialLot: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn((a: any) => { lots.push(a.data); return Promise.resolve(a.data); }),
      },
      rawMaterialInventory: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn(() => Promise.resolve({})),
      },
      accountingEvent: {
        create: jest.fn((a: any) => { events.push(a.data); return Promise.resolve({}); }),
      },
      $transaction: jest.fn((fn: any) => fn(prisma)),
    };
    const periods: any = { assertDateIsOpen: jest.fn().mockResolvedValue(undefined) };
    const svc = new ImportService(prisma, periods) as any;
    const run = (rows: string[][]) => svc.importStockReceipts(
      {
        originalname: 'receipts.csv',
        buffer: Buffer.from([HEADER, ...rows].map((r) => r.join(',')).join('\n'), 'utf-8'),
      } as never,
      TENANT, 'u1',
    );
    return { run, lots, wac, events };
  }

  // 1000 g at ₱1.12 VAT-inclusive: ₱1,120 paid, ₱1,000 of shelf, ₱120 input tax.
  const row = (method: string) =>
    ['2026-08-30', 'Coffee Beans', '1000', '1.12', 'Main Branch', method, '', 'DR-1'];

  describe('VAT-registered shop, bought with money', () => {
    it('values the lot at the net cost, like the receive form does', async () => {
      const { run, lots } = build('VAT');
      await run([row('CASH')]);
      expect(Number(lots[0].unitCost)).toBeCloseTo(1.0, 4);
    });

    it('blends the weighted average on the net basis', async () => {
      // This is the one that mattered: a gross opening cost and net deliveries
      // averaged together give a recipe cost that is wrong and stays wrong.
      const { run, wac } = build('VAT');
      await run([row('CASH')]);
      expect(Number(wac[0].costPrice)).toBeCloseTo(1.0, 4);
    });

    it('capitalises the net and records the input tax and the money paid', async () => {
      const { run, events } = build('VAT');
      await run([row('CREDIT')]);
      const p: any = events[0].payload;
      expect(Number(p.totalValue)).toBeCloseTo(1000, 2);
      expect(Number(p.inputVat)).toBeCloseTo(120, 2);
      expect(Number(p.grossValue)).toBeCloseTo(1120, 2);
      expect(Number(p.totalValue) + Number(p.inputVat)).toBeCloseTo(Number(p.grossValue), 2);
    });
  });

  describe('stock the owner brought in', () => {
    it('claims nothing, because there is no supplier and no invoice', async () => {
      const { run, lots, events } = build('VAT');
      await run([row('OWNER_FUNDED')]);
      expect(Number(lots[0].unitCost)).toBeCloseTo(1.12, 4);
      expect(Number((events[0].payload as any).totalValue)).toBeCloseTo(1120, 2);
    });

    it('is what a blank payment-method column means', async () => {
      // The default, and therefore the case where the two paths always agreed
      // and the bug stayed hidden.
      const { run, lots } = build('VAT');
      await run([['2026-08-30', 'Coffee Beans', '1000', '1.12', 'Main Branch', '', '', 'DR-2']]);
      expect(Number(lots[0].unitCost)).toBeCloseTo(1.12, 4);
    });
  });

  describe('shop that is not VAT-registered', () => {
    it('takes the price as the cost, because nothing is recoverable', async () => {
      const { run, lots } = build('NON_VAT');
      await run([row('CASH')]);
      expect(Number(lots[0].unitCost)).toBeCloseTo(1.12, 4);
    });

    it('treats an unregistered shop the same way', async () => {
      const { run, lots } = build('UNREGISTERED');
      await run([row('CASH')]);
      expect(Number(lots[0].unitCost)).toBeCloseTo(1.12, 4);
    });
  });
});
