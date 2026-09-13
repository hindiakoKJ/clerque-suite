import { ValidationPipe } from '@nestjs/common';
import { CostSanityService } from './cost-sanity.service';
import { SanityConfirmRequiredException, sanityContext } from './sanity.types';
import { RecordBoughtDto } from '../../procure/dto/receive-request.dto';
import { ReceiveRawMaterialDto } from '../../inventory/dto/receive-raw-material.dto';
import { ConfirmReceiptDto } from '../../procure/dto/receipts.dto';
import { UpdateProductDto } from '../../products/dto/update-product.dto';
import { CreateProductDto } from '../../products/dto/create-product.dto';

/**
 * "Are you sure this is the correct cost?" — the server half.
 *
 * The rules are tested on their own in price-sanity.spec.ts. What is pinned
 * here is everything around them that a rule cannot know: which past
 * deliveries count as a price at all, what tax basis they were saved in, whose
 * branch they came from, and whether a request has already answered the
 * question for exactly the number it is sending.
 */
describe('CostSanityService', () => {
  const TENANT = 't1';
  const MILK = 'rm-milk';
  const DAY = 86_400_000;
  const recent = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY);

  type Lot = { branchId?: string; unitCost: number; paymentMethod?: string; createdAt?: Date; referenceNumber?: string | null };

  function build(opts: {
    lots?: Lot[];
    taxStatus?: 'VAT' | 'NON_VAT' | 'UNREGISTERED';
    costPrice?: number | null;
    unit?: string;
    unitChangedAt?: Date | null;
    usualPackSize?: number | null;
    batchYield?: number | null;
    showCostsToStaff?: boolean;
  } = {}) {
    const lots = (opts.lots ?? []).map((l, i) => ({
      branchId: l.branchId ?? 'b1',
      unitCost: l.unitCost,
      paymentMethod: l.paymentMethod ?? 'CASH',
      createdAt: l.createdAt ?? recent(i + 1),
      referenceNumber: l.referenceNumber ?? `REQ-${i}`,
    }));
    const audit: any[] = [];
    const prisma: any = {
      tenant: { findUnique: jest.fn().mockResolvedValue({ taxStatus: opts.taxStatus ?? 'UNREGISTERED', showPurchaseCostsToStaff: opts.showCostsToStaff ?? true }) },
      rawMaterial: {
        findMany: jest.fn().mockResolvedValue([{ id: MILK, name: 'Full cream milk', unit: opts.unit ?? 'ml', costPrice: opts.costPrice ?? null, batchYield: opts.batchYield ?? null }]),
      },
      // Honours the parts of the query the history depends on, as the database would:
      // purchases only (no ST- or BATCH- references), the window, the branch, the limit.
      rawMaterialLot: {
        findMany: jest.fn(({ where, take }: any) => Promise.resolve(lots
          .filter((l) => !/^(ST-|BATCH-)/.test(l.referenceNumber ?? ''))
          .filter((l) => !where.branchId || l.branchId === where.branchId)
          .filter((l) => !where.createdAt?.gte || l.createdAt >= where.createdAt.gte)
          .slice(0, take ?? lots.length))),
      },
      auditLog: {
        findFirst: jest.fn().mockResolvedValue(opts.unitChangedAt ? { createdAt: opts.unitChangedAt } : null),
        create: jest.fn(({ data }: any) => { audit.push(data); return Promise.resolve({}); }),
      },
      purchaseRequestLine: {
        findFirst: jest.fn().mockResolvedValue(opts.usualPackSize ? { packSize: opts.usualPackSize } : null),
      },
    };
    return { svc: new CostSanityService(prisma), prisma, audit };
  }

  // ₱85–₱90 per 1,000 ml, stored per ml.
  const MILK_HISTORY: Lot[] = [90, 90, 89, 88, 88, 87, 86, 85].map((p) => ({ unitCost: p / 1000 }));

  const line = (packCost: number, packSize = 1000) => ({
    key: 'line:l1', rawMaterialId: MILK, grossPerUnit: packCost / packSize, packSize, packCost, branchId: 'b1',
  });

  describe('judging an ingredient cost', () => {
    it("asks about the owner's own example, in the owner's own terms", async () => {
      const { svc } = build({ lots: MILK_HISTORY });
      const [w] = await svc.checkIngredientCosts(TENANT, [line(190)]);
      expect(w).toBeDefined();
      expect(w!.kind).toBe('INGREDIENT_COST');
      expect(w!.severity).toBe('unusual');
      expect(w!.message).toMatch(/Full cream milk: ₱190\.00 for 1,000 ml/);
      expect(w!.message).toMatch(/usually been ₱86\.\d\d to ₱89\.\d\d over the last 8 deliveries/);
      expect(w!.message).toMatch(/Is this the correct cost\?$/);
      expect(w!.typed).toBe(190);
    });

    it('does not ask about an ordinary price', async () => {
      const { svc } = build({ lots: MILK_HISTORY });
      expect(await svc.checkIngredientCosts(TENANT, [line(95)])).toEqual([]);
    });

    it('does not count a transfer or a kitchen batch as a price', async () => {
      const { svc } = build({
        lots: [
          ...[90, 88, 86].map((p) => ({ unitCost: p / 1000 })),
          { unitCost: 0.5, referenceNumber: 'ST-2026-000004' },
          { unitCost: 0.5, referenceNumber: 'ST-2026-000004-CANCELLED' },
          { unitCost: 0.5, referenceNumber: 'BATCH-2026-09-10-abc123' },
        ],
      });
      // Counted, those three at ₱500 would make ₱190 look cheap.
      const [w] = await svc.checkIngredientCosts(TENANT, [line(190)]);
      expect(w).toBeDefined();
      expect(w!.points).toBe(3);
    });

    it('asks only for recent purchases and never counts a write-off', async () => {
      const { svc, prisma } = build({ lots: MILK_HISTORY });
      await svc.checkIngredientCosts(TENANT, [line(190)]);
      const where = prisma.rawMaterialLot.findMany.mock.calls[0][0].where;
      expect(where.qtyReceived).toEqual({ gt: 0 });      // a write-off's marker lot is negative
      expect(where.unitCost).toEqual({ gt: 0 });
      expect(where.createdAt.gte.getTime()).toBeGreaterThan(Date.now() - 181 * DAY);
    });

    it("puts a VAT shop's net deliveries back to what the receipt said", async () => {
      // A VAT shop keeps the shelf net: ₱88 printed is stored as 78.57. The
      // owner types what the receipt says, so the trend must be gross too.
      const vatLots = [90, 90, 89, 88, 88, 87, 86, 85].map((p) => ({ unitCost: p / 1.12 / 1000 }));
      const { svc } = build({ lots: vatLots, taxStatus: 'VAT' });
      expect(await svc.checkIngredientCosts(TENANT, [line(95)])).toEqual([]);
      expect(await svc.checkIngredientCosts(TENANT, [line(190)])).toHaveLength(1);
    });

    it('does not add VAT twice to deliveries saved before the shelf was kept net', async () => {
      const old = recent(20);          // well before today, but …
      old.setTime(new Date('2026-08-20T00:00:00Z').getTime());  // … before 30 August
      const grossBack = [90, 90, 89, 88, 88].map((p) => ({ unitCost: p / 1000, createdAt: old }));
      const { svc } = build({ lots: grossBack, taxStatus: 'VAT' });
      // Multiplied by 1.12 again the band would sit near ₱99 and a real ₱88 would look low.
      const w = await svc.checkIngredientCosts(TENANT, [line(88)]);
      expect(w).toEqual([]);
    });

    it("treats an owner's own money as having no VAT to take back", async () => {
      const ownerLots = [90, 90, 89, 88, 88].map((p) => ({ unitCost: p / 1000, paymentMethod: 'OWNER_FUNDED' }));
      const { svc } = build({ lots: ownerLots, taxStatus: 'VAT' });
      expect(await svc.checkIngredientCosts(TENANT, [line(92)])).toEqual([]);
    });

    it("prefers the branch's own prices when it has enough of them", async () => {
      const { svc } = build({
        lots: [
          ...[150, 150, 150].map((p) => ({ unitCost: p / 1000, branchId: 'kiosk' })),
          ...[88, 88, 88, 88, 88].map((p) => ({ unitCost: p / 1000, branchId: 'main' })),
        ],
      });
      // ₱150 is normal at the kiosk and would be asked about at the main shop.
      expect(await svc.checkIngredientCosts(TENANT, [{ ...line(150), branchId: 'kiosk' }])).toEqual([]);
      expect(await svc.checkIngredientCosts(TENANT, [{ ...line(150), branchId: 'main' }])).toHaveLength(1);
    });

    it('sets aside deliveries priced in a unit the ingredient no longer uses', async () => {
      const changed = recent(3);
      const { svc } = build({
        lots: [
          { unitCost: 0.09, createdAt: recent(2) },        // after the change, per ml
          { unitCost: 90, createdAt: recent(10) },         // before, per litre
          { unitCost: 90, createdAt: recent(11) },
          { unitCost: 90, createdAt: recent(12) },
        ],
        unitChangedAt: changed,
      });
      const [w] = await svc.checkIngredientCosts(TENANT, [line(190)]);
      expect(w!.points).toBe(1);
    });

    it('calls a ten-times price a magnitude mistake and says what to check', async () => {
      const { svc } = build({ lots: MILK_HISTORY, costPrice: 0.088 });
      // ₱90 typed with "one pack holds 100" instead of 1,000.
      const [w] = await svc.checkIngredientCosts(TENANT, [line(90, 100)]);
      expect(w!.severity).toBe('magnitude');
      expect(w!.message).toMatch(/wrong unit or pack size/);
    });

    it('is more forgiving of a pack far bigger or smaller than usual', async () => {
      const sugar = [0.05, 0.05, 0.05, 0.05, 0.05].map((c) => ({ unitCost: c }));
      const emergencyBag = { key: 'line:s', rawMaterialId: MILK, grossPerUnit: 0.075, packSize: 1000, packCost: 75, branchId: 'b1' };
      expect(await build({ lots: sugar, usualPackSize: 50_000 }).svc.checkIngredientCosts(TENANT, [emergencyBag])).toEqual([]);
      expect(await build({ lots: sugar, usualPackSize: 1000 }).svc.checkIngredientCosts(TENANT, [emergencyBag])).toHaveLength(1);
    });
  });

  describe('what the review found', () => {
    it("calls a price ten times off on the old guard's own basis, so a yes always answers the guard too", async () => {
      // A VAT shop paying with the owner's own money keeps the cost on file as
      // printed: ₱0.10 per g. The guard compares ₱1.00 with ₱0.10 -- ten times --
      // while the gross-up alone would have called it 8.9 times, "unusual".
      const { svc } = build({ lots: [0.1, 0.1, 0.1].map((c) => ({ unitCost: c, paymentMethod: 'OWNER_FUNDED' })), taxStatus: 'VAT', costPrice: 0.1 });
      const [w] = await svc.checkIngredientCosts(TENANT, [{ key: 'row:0', rawMaterialId: MILK, grossPerUnit: 1.0, paymentMethod: 'OWNER_FUNDED' }]);
      expect(w!.severity).toBe('magnitude');
    });

    it('does not recite the usual prices to someone the shop hides purchase costs from', async () => {
      const { svc } = build({ lots: MILK_HISTORY, showCostsToStaff: false });
      const [w] = await svc.checkIngredientCosts(TENANT, [line(190)], sanityContext('1', undefined, 'wh-1', 'WAREHOUSE_STAFF'));
      expect(w).toBeDefined();
      expect(w!.message).not.toMatch(/₱8\d/);
      expect(w!.message).toMatch(/well above what it usually costs/);
      expect(w!.usualLow).toBeNull();
      expect(w!.usualHigh).toBeNull();
      expect(w!.points).toBe(0);
    });

    it('still recites them to the owner on the same shop', async () => {
      const { svc } = build({ lots: MILK_HISTORY, showCostsToStaff: false });
      const [w] = await svc.checkIngredientCosts(TENANT, [line(190)], sanityContext('1', undefined, 'owner-1', 'BUSINESS_OWNER'));
      expect(w!.message).toMatch(/usually been ₱86/);
    });

    it('reads no history at all for a client that cannot be asked', async () => {
      const { svc, prisma } = build({ lots: MILK_HISTORY });
      expect(await svc.checkIngredientCosts(TENANT, [line(190)], sanityContext(undefined, undefined))).toEqual([]);
      expect(prisma.rawMaterialLot.findMany).not.toHaveBeenCalled();
    });

    it('has no purchase trend for something made in the kitchen', async () => {
      // A syrup's lots are batches; only the cost on file says what it costs.
      const { svc } = build({ lots: MILK_HISTORY, batchYield: 1130, costPrice: 0.088 });
      const [w] = await svc.checkIngredientCosts(TENANT, [line(140)]);
      expect(w).toBeUndefined();                       // 1.59x: inside the wider band
      const [w2] = await svc.checkIngredientCosts(TENANT, [line(160)]);
      expect(w2!.points).toBe(0);                       // judged on the cost on file
    });

    it('shows Edit Ingredient figures as they sit in the box, not with VAT added', async () => {
      const vatLots = [90, 90, 89, 88, 88].map((p) => ({ unitCost: p / 1.12 / 1000 }));
      const { svc } = build({ lots: vatLots, taxStatus: 'VAT', costPrice: 0.0786 });
      const typed = 0.5;   // net, as the box holds it
      const [w] = await svc.checkIngredientCosts(TENANT, [{ key: 'rm:x:cost', rawMaterialId: MILK, grossPerUnit: typed * 1.12, storedBasisPerUnit: typed }]);
      expect(w!.message).toMatch(/₱0\.50 per ml/);
      expect(w!.message).not.toMatch(/₱0\.56/);
    });

    it('with three or four deliveries says "usually" the middle price, not a range an outlier stretched', async () => {
      const { svc } = build({ lots: [88, 88, 190].map((p) => ({ unitCost: p / 1000 })) });
      const [w] = await svc.checkIngredientCosts(TENANT, [line(250)]);
      expect(w!.message).toMatch(/usually been ₱88\.00 over the last 3 deliveries/);
    });

    it('does not call an unfinished recipe "in the wrong unit"', async () => {
      const { svc } = build();
      const cheapButUnfinished = await svc.checkProduct(TENANT, {
        key: 'product:p1', name: 'Latte', priorPrice: 140, price: 140, cost: 0.75, partlyPriced: true,
        vatable: true, checkPrice: false, checkMargin: true,
      });
      expect(cheapButUnfinished).toEqual([]);
    });

    it('asks when turning VAT on takes a thin drink into a loss', async () => {
      const { svc } = build({ taxStatus: 'VAT' });
      const [w] = await svc.checkProduct(TENANT, {
        key: 'product:p1', name: 'Iced Tea', priorPrice: 105, price: 105, priorCost: 95, cost: 95,
        vatable: true, priorVatable: false, checkPrice: false, checkMargin: true,
      });
      expect(w!.kind).toBe('MARGIN');
    });

    it('treats a cost rounded to the centavo as the same cost', async () => {
      const { svc } = build();
      const same = await svc.checkProduct(TENANT, {
        key: 'product:p1', name: 'Iced Latte', priorPrice: 150, price: 150, priorCost: 160.12, cost: 160.1234,
        vatable: false, checkPrice: false, checkMargin: true,
      });
      expect(same).toEqual([]);
    });
  });

  describe('asking, and taking the answer', () => {
    const warn = async () => (await build({ lots: MILK_HISTORY }).svc.checkIngredientCosts(TENANT, [line(190)]));

    it('refuses a client that can show the question and has not answered it', async () => {
      const { svc } = build({ lots: MILK_HISTORY });
      const warnings = await svc.checkIngredientCosts(TENANT, [line(190)]);
      expect(() => svc.enforce(warnings, sanityContext('1', undefined))).toThrow(SanityConfirmRequiredException);
    });

    it('carries the warnings on the refusal, as a 409 with its own code', async () => {
      const { svc } = build({ lots: MILK_HISTORY });
      const warnings = await svc.checkIngredientCosts(TENANT, [line(190)]);
      try {
        svc.enforce(warnings, sanityContext('1', undefined));
        fail('expected a refusal');
      } catch (err) {
        const e = err as SanityConfirmRequiredException;
        expect(e.getStatus()).toBe(409);
        const body = e.getResponse() as any;
        expect(body.code).toBe('SANITY_CONFIRM_REQUIRED');
        expect(body.warnings[0].key).toBe('line:l1');
      }
    });

    it('lets the save through once that exact value is confirmed', async () => {
      const { svc } = build({ lots: MILK_HISTORY });
      const warnings = await svc.checkIngredientCosts(TENANT, [line(190)]);
      const confirmed = svc.enforce(warnings, sanityContext('1', [{ key: 'line:l1', value: warnings[0]!.value }]));
      expect(confirmed).toHaveLength(1);
    });

    it('asks again when the price was changed after it was confirmed', async () => {
      const { svc } = build({ lots: MILK_HISTORY });
      const first = await warn();
      const retyped = await svc.checkIngredientCosts(TENANT, [line(290)]);
      expect(() => svc.enforce(retyped, sanityContext('1', [{ key: 'line:l1', value: first[0]!.value }])))
        .toThrow(SanityConfirmRequiredException);
    });

    it('does not let an answer for one box clear another', async () => {
      const { svc } = build({ lots: MILK_HISTORY });
      const warnings = await svc.checkIngredientCosts(TENANT, [line(190)]);
      expect(() => svc.enforce(warnings, sanityContext('1', [{ key: 'line:other', value: warnings[0]!.value }])))
        .toThrow(SanityConfirmRequiredException);
    });

    it('keeps today\'s behaviour for a client that cannot show the question', async () => {
      // An older till, or the phone app before its update: no refusal it
      // cannot answer. The order-of-magnitude guard still protects it.
      const { svc } = build({ lots: MILK_HISTORY });
      const warnings = await svc.checkIngredientCosts(TENANT, [line(190)]);
      expect(svc.enforce(warnings, sanityContext(undefined, undefined))).toEqual([]);
    });

    it('writes down who said yes, and to what', async () => {
      const { svc, audit } = build({ lots: MILK_HISTORY });
      const warnings = await svc.checkIngredientCosts(TENANT, [line(190)]);
      await svc.recordConfirmed(TENANT, 'owner-1', warnings, () => ({ type: 'PurchaseRequestLine', id: 'l1' }));
      expect(audit[0]).toMatchObject({
        tenantId: TENANT, action: 'PRICE_ADJUSTED', entityType: 'PurchaseRequestLine', entityId: 'l1', performedBy: 'owner-1',
      });
      expect(audit[0].after).toMatchObject({ key: 'line:l1', severity: 'unusual', value: warnings[0]!.value });
    });
  });

  describe('judging a selling price and a margin', () => {
    it('asks about a price jump against the price it replaces', async () => {
      const { svc } = build();
      const [w] = await svc.checkProduct(TENANT, {
        key: 'product:p1', productId: 'p1', name: 'Iced Latte', priorPrice: 150, price: 1500, cost: null,
        vatable: true, checkPrice: true, checkMargin: false,
      });
      expect(w!.kind).toBe('SELL_PRICE');
      expect(w!.message).toMatch(/Iced Latte was ₱150\.00\. ₱1,500\.00 is about 10\.0 times as much\. Is this the correct selling price\?/);
    });

    it('asks when a drink would cost more to make than it sells for', async () => {
      const { svc } = build();
      const [w] = await svc.checkProduct(TENANT, {
        key: 'product:p1', productId: 'p1', name: 'Iced Latte', priorPrice: 150, price: 150, cost: 210,
        vatable: true, checkPrice: false, checkMargin: true,
      });
      expect(w!.kind).toBe('MARGIN');
      expect(w!.message).toMatch(/costs ₱210\.00 to make and sells for ₱150\.00, so every one sold loses ₱60\.00/);
    });

    it('does not ask again about a drink that already lost money, when nothing got worse', async () => {
      const { svc } = build();
      const already = await svc.checkProduct(TENANT, {
        key: 'product:p1', name: 'Iced Latte', priorPrice: 150, price: 150, priorCost: 210, cost: 210,
        vatable: true, checkPrice: false, checkMargin: true,
      });
      expect(already).toEqual([]);
      const worse = await svc.checkProduct(TENANT, {
        key: 'product:p1', name: 'Iced Latte', priorPrice: 150, price: 150, priorCost: 210, cost: 240,
        vatable: true, checkPrice: false, checkMargin: true,
      });
      expect(worse).toHaveLength(1);
    });

    it('asks about a recipe so cheap an ingredient must be in the wrong unit', async () => {
      const { svc } = build();
      const [w] = await svc.checkProduct(TENANT, {
        key: 'product:p1', name: 'Iced Latte', priorPrice: 150, price: 150, cost: 0.4,
        vatable: true, checkPrice: false, checkMargin: true,
      });
      expect(w!.severity).toBe('magnitude');
      expect(w!.message).toMatch(/wrong unit/);
    });
  });

  /*
    main.ts runs the ValidationPipe with whitelist and forbidNonWhitelisted.
    A service spec never passes through it, so this is the only thing that
    proves a confirmed retry is not refused with "property sanityConfirmations
    should not exist" before it reaches the service.
  */
  describe('a confirmed retry gets past request validation', () => {
    const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
    const answers = { sanityConfirmations: [{ key: 'line:l1', value: '0.190000' }] };

    it.each([
      ['recording what was bought', RecordBoughtDto, { lines: [{ lineId: 'l1', packsBought: 1, packSize: 1000, packCost: 190 }], ...answers }],
      ['receiving on Stock on hand', ReceiveRawMaterialDto, { branchId: 'b1', quantity: 1000, costPrice: 0.19, ...answers }],
      ['confirming a receipt', ConfirmReceiptDto, { paymentMethod: 'CASH', lines: [{ rawMaterialId: MILK, packsBought: 1, packSize: 1000, packCost: 190 }], ...answers }],
      ['editing a product', UpdateProductDto, { price: 1500, ...answers }],
      ['creating a product', CreateProductDto, { name: 'Iced Latte', price: 150, costPrice: 45, ...answers }],
    ])('when %s', async (_label, metatype, body) => {
      const out = await pipe.transform(body, { type: 'body', metatype: metatype as never });
      expect(out.sanityConfirmations).toEqual(answers.sanityConfirmations);
    });

    it('still refuses a malformed answer', async () => {
      await expect(pipe.transform(
        { price: 1500, sanityConfirmations: [{ key: 'x' }] },
        { type: 'body', metatype: UpdateProductDto as never },
      )).rejects.toBeDefined();
    });
  });
});
