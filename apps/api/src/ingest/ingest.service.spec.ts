import { IngestService } from './ingest.service';
import { pesos } from './courtside.types';
import type { CourtSideSaleEvent, CourtSideRefundEvent } from './courtside.types';
import { minorToMajor } from './magnetmoments.types';
import type { MagnetSaleEvent, MagnetRefundEvent } from './magnetmoments.types';
import { BadRequestException } from '@nestjs/common';

/**
 * CourtSide ingest — idempotency, sale delegation, and refund posting.
 *
 * The heavy end-to-end (three distinct revenue accounts actually credited, OR
 * issued) is proven by the live smoke; these pin the routing decisions that
 * are easy to get wrong: not double-posting on replay, NOT re-pricing an
 * already-paid sale, and posting a refund as contra-income + VAT reversal.
 */
describe('IngestService', () => {
  const TENANT = 'club-1';

  const sale = (over: Partial<CourtSideSaleEvent> = {}): CourtSideSaleEvent => ({
    event_type: 'sale', club_ref: 'club', occurred_at: '2026-07-26T10:00:00.000Z',
    order_ref: 'BK-2026-001',
    customer: { player_ref: null, name: 'Ana Cruz', mobile: '+639170000000' },
    tender: { type: 'online', channel: 'gcash', provider_ref: 'xnd_abc' },
    totals: { gross_centavos: 336000, discount_centavos: 0, fee_centavos: 0, net_centavos: 336000, provider_fee_centavos: 0, currency: 'PHP' },
    lines: [
      { type: 'court_time',       description: 'Court 3 1hr', qty: 1, unit: 'hour', unit_price_centavos: 112000, amount_centavos: 112000 },
      { type: 'open_play_seat',   description: 'Open Play',    qty: 1, unit: 'seat', unit_price_centavos: 112000, amount_centavos: 112000 },
      { type: 'tournament_entry', description: 'Tourney',      qty: 1, unit: 'ea',   unit_price_centavos: 112000, amount_centavos: 112000 },
    ],
    tax: { treatment: 'TBD', vat_centavos: 0 },
    ...over,
  });

  const build = (opts: { existingReceipt?: any; products?: Array<{ id: string; name: string; sku: string; costPrice: number | null }> } = {}) => {
    const created = { id: 'ord-1', orderNumber: 'ORD-2026-000001' };
    const productStore: Array<{ id: string; name: string; sku: string; costPrice: number | null }> = [...(opts.products ?? [])];
    const prisma: any = {
      ingestReceipt: {
        findUnique: jest.fn().mockResolvedValue(opts.existingReceipt ?? null),
        create:     jest.fn().mockResolvedValue({}),
      },
      tenant: { findUnique: jest.fn().mockResolvedValue({ taxStatus: 'VAT', currency: 'PHP' }) },
      branch: { findFirst: jest.fn().mockResolvedValue({ id: 'branch-1' }) },
      product: {
        // CourtSide path (find-or-create by sku).
        findFirst: jest.fn().mockImplementation(({ where }: any) =>
          Promise.resolve({ id: `prod-${where.sku}`, name: where.sku })),
        // Magnet catalog path: a tiny in-memory store so seeding + idempotency
        // are actually exercised (findMany by sku-in, create appends).
        findMany: jest.fn().mockImplementation(({ where }: any) =>
          Promise.resolve(productStore.filter((p) => where.sku.in.includes(p.sku)))),
        create: jest.fn().mockImplementation(({ data }: any) => {
          const p = { id: `prod-${data.sku}`, name: data.name, sku: data.sku,
                      costPrice: data.costPrice != null ? Number(data.costPrice) : null };
          productStore.push(p);
          return Promise.resolve(p);
        }),
      },
      category: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 'cat-magnets', revenueAccountCode: '4010' }), update: jest.fn() },
    };
    const orders  = { create: jest.fn().mockResolvedValue(created) };
    const journal = { create: jest.fn().mockResolvedValue({ id: 'je-1' }) };
    const accounts = {
      findByCode: jest.fn().mockImplementation((_t: string, code: string) =>
        Promise.resolve({ id: `acct-${code}`, code })),
    };
    const tax = { computeTaxBreakdown: (gross: number, status: string) =>
      status === 'VAT'
        ? { netAmount: Math.round((gross / 1.12) * 100) / 100, vatAmount: Math.round((gross - gross / 1.12) * 100) / 100, grossAmount: gross, totalAmount: gross }
        : { netAmount: gross, vatAmount: 0, grossAmount: gross, totalAmount: gross } };

    const svc = new IngestService(prisma, orders as any, journal as any, accounts as any, tax as any);
    return { svc, prisma, orders, journal, accounts, productStore };
  };

  it('pesos() converts integer centavos exactly, no float drift', () => {
    expect(pesos(112000)).toBe(1120);
    expect(pesos(1)).toBe(0.01);
    expect(pesos(99999)).toBe(999.99);
  });

  it('posts a sale as an API-channel CASH_SALE and does NOT re-price it', async () => {
    const { svc, orders } = build();
    const res = await svc.ingest(TENANT, 'key-1', 'branch-1', sale());

    expect(res.replayed).toBe(false);
    expect(orders.create).toHaveBeenCalledTimes(1);
    const [, cashierId, offline, opts] = orders.create.mock.calls[0];
    expect(cashierId).toBeNull();                       // machine, no cashier
    expect(offline.invoiceType).toBe('CASH_SALE');      // already paid, not a receivable
    expect(offline.totalAmount).toBe(3360);
    expect(opts).toMatchObject({
      channel: 'API', createdByApiKeyId: 'key-1', externalRef: 'BK-2026-001',
      enforceServerTotals: false,                        // CourtSide owns the price
    });
  });

  it('carries the provider_ref onto the payment for Xendit reconciliation', async () => {
    const { svc, orders } = build();
    await svc.ingest(TENANT, 'key-1', 'branch-1', sale());
    const offline = orders.create.mock.calls[0][2];
    expect(offline.payments[0].reference).toBe('xnd_abc');
    expect(offline.payments[0].method).toBe('GCASH_BUSINESS');
  });

  it('is a no-op on re-delivery of the same order_ref', async () => {
    const { svc, orders } = build({
      existingReceipt: { resultJson: { orderId: 'ord-1', orderNumber: 'ORD-2026-000001' } },
    });
    const res = await svc.ingest(TENANT, 'key-1', 'branch-1', sale());
    expect(res.replayed).toBe(true);
    expect(orders.create).not.toHaveBeenCalled();       // no second sale
  });

  it('posts a refund as contra-income (4116) + VAT reversal, crediting 1031', async () => {
    const { svc, journal } = build();
    const refund: CourtSideRefundEvent = {
      event_type: 'refund', club_ref: 'club', occurred_at: '2026-07-27T09:00:00.000Z',
      order_ref: 'BK-2026-001', refund_ref: 'RF-1', reason: 'cancellation',
      totals: { net_centavos: -112000, currency: 'PHP' },
    };
    await svc.ingest(TENANT, 'key-1', 'branch-1', refund);

    expect(journal.create).toHaveBeenCalledTimes(1);
    const [tenantId, dto, createdBy, source] = journal.create.mock.calls[0];
    expect(tenantId).toBe(TENANT);
    expect(source).toBe('SYSTEM');
    const codes = dto.lines.map((l: any) => l.accountId);
    expect(codes).toContain('acct-4116');               // refunds contra-income (debit)
    expect(codes).toContain('acct-2020');               // output VAT reversed (debit)
    expect(codes).toContain('acct-1031');               // digital receivable (credit)
    // Balanced: debits (net + vat) == credit (total).
    const debit  = dto.lines.reduce((s: number, l: any) => s + (l.debit ?? 0), 0);
    const credit = dto.lines.reduce((s: number, l: any) => s + (l.credit ?? 0), 0);
    expect(Math.round(debit * 100)).toBe(Math.round(credit * 100));
    expect(Math.round(credit * 100)).toBe(112000);      // ₱1120 returned
  });

  // ─── magnetmoments.cc (Magnet Books) ─────────────────────────────────────

  describe('magnetmoments', () => {
    const magnetSale = (over: Partial<MagnetSaleEvent> = {}): MagnetSaleEvent => ({
      event_type: 'sale', shop_ref: 'shop', occurred_at: '2026-08-01T10:00:00.000Z',
      order_ref: 'MM-1001',
      customer: { name: 'Mae Reyes' },
      tender: { type: 'online', channel: 'gcash', provider_ref: 'gc_123' },
      lines: [
        { sku: 'sq_2', description: '2x2 magnet',  qty: 3, unit_price_minor: 5000,  amount_minor: 15000 },
        { sku: 'sq_3', description: '3x3 magnet',  qty: 1, unit_price_minor: 8050,  amount_minor: 8050 },
      ],
      totals: { amount_minor: 23050, currency: 'PHP' },
      ...over,
    });

    const magnetRefund = (over: Partial<MagnetRefundEvent> = {}): MagnetRefundEvent => ({
      event_type: 'refund', shop_ref: 'shop', occurred_at: '2026-08-02T09:00:00.000Z',
      order_ref: 'MM-1001', refund_ref: 'MMR-1', reason: 'damaged in transit',
      totals: { amount_minor: 5000, currency: 'PHP' },
      ...over,
    });

    it('minorToMajor() converts integer minor units exactly, no float drift', () => {
      expect(minorToMajor(23050)).toBe(230.5);
      expect(minorToMajor(1)).toBe(0.01);
      expect(minorToMajor(8050)).toBe(80.5);
    });

    it('posts a magnet sale as an API-channel CASH_SALE, gross (no VAT), and does NOT re-price it', async () => {
      const { svc, orders } = build();
      const res = await svc.ingestMagnet(TENANT, 'key-1', 'branch-1', magnetSale());

      expect(res.replayed).toBe(false);
      expect(orders.create).toHaveBeenCalledTimes(1);
      const [, cashierId, offline, opts] = orders.create.mock.calls[0];
      expect(cashierId).toBeNull();
      expect(offline.invoiceType).toBe('CASH_SALE');
      expect(offline.vatAmount).toBe(0);                  // books are gross
      expect(offline.totalAmount).toBe(230.5);            // 23050 / 100 exactly
      expect(offline.items).toHaveLength(2);
      // Each line routes to its own SIZE product by sku (not one generic anchor).
      expect(offline.items[0].productId).toBe('prod-sq_2');
      expect(offline.items[1].productId).toBe('prod-sq_3');
      expect(offline.items[0].vatAmount).toBe(0);
      expect(offline.items[0].isVatable).toBe(false);
      expect(offline.items[0].lineTotal).toBe(150);
      expect(offline.clientUuid).toBe('magnetmoments:MM-1001');
      expect(opts).toMatchObject({
        channel: 'API', createdByApiKeyId: 'key-1', externalRef: 'MM-1001',
        enforceServerTotals: false,                        // the shop owns the price
      });
    });

    // ── Per-size placeholder catalog (one product per magnet size, own cost + price) ──

    it('seeds the full placeholder catalog on first contact — 12 sizes + the generic anchor, in the Magnets category → 4010', async () => {
      const { svc, prisma, productStore } = build();
      const { created, bySku, generic } = await svc.ensureMagnetCatalog(TENANT);
      expect(created).toBe(13);                                       // 12 sizes + generic
      expect(bySku.size).toBe(13);
      expect(productStore.map((p) => p.sku).sort()).toEqual([
        '__MAGNET_SALE__', 'rect_2x3', 'rect_65x90', 'rect_wallet', 'round_25', 'round_32', 'round_44',
        'round_58', 'round_75', 'sheet_atm', 'sq_2', 'sq_2_5', 'sq_3',
      ]);
      // Every size carries its own placeholder cost + price; the anchor carries none.
      const sq3 = prisma.product.create.mock.calls.find((c: any) => c[0].data.sku === 'sq_3')![0].data;
      expect(Number(sq3.price)).toBe(10);
      expect(Number(sq3.costPrice)).toBe(3);
      expect(sq3.isVatable).toBe(false);                              // books gross
      expect(generic.costPrice).toBeNull();
      // Category carries the retail revenue account.
      expect(prisma.category.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ name: 'Magnets', revenueAccountCode: '4010' }),
      }));
    });

    it('seeding is idempotent and NEVER overwrites the seller\'s own cost/price', async () => {
      // Seller already edited sq_2 to their real numbers.
      const { svc, prisma } = build({ products: [{ id: 'prod-sq_2', name: 'My 2x2', sku: 'sq_2', costPrice: 1.75 }] });
      const first = await svc.ensureMagnetCatalog(TENANT);
      expect(first.created).toBe(12);                                 // 11 missing sizes + generic; sq_2 untouched
      expect(first.bySku.get('sq_2')).toEqual({ id: 'prod-sq_2', name: 'My 2x2', costPrice: 1.75 });
      expect(prisma.product.create.mock.calls.some((c: any) => c[0].data.sku === 'sq_2')).toBe(false);
      // Second run creates nothing.
      const second = await svc.ensureMagnetCatalog(TENANT);
      expect(second.created).toBe(0);
    });

    it('stamps each line with ITS size\'s costPrice so COGS posts per size; unknown sku → generic anchor, no cost', async () => {
      const { svc, orders } = build();
      await svc.ingestMagnet(TENANT, 'key-1', 'branch-1', magnetSale({
        lines: [
          { sku: 'sq_2',     description: '2x2', qty: 3, unit_price_minor: 5000, amount_minor: 15000 },
          { sku: 'round_58', description: '58',  qty: 1, unit_price_minor: 6000, amount_minor: 6000 },
          { sku: 'mystery',  description: '??',  qty: 1, unit_price_minor: 2050, amount_minor: 2050 },   // unknown sku
        ],
        totals: { amount_minor: 23050, currency: 'PHP' },
      }));
      const offline = orders.create.mock.calls[0][2];
      expect(offline.items[0].productId).toBe('prod-sq_2');
      expect(offline.items[0].costPrice).toBe(2);                     // sq_2 placeholder cost → COGS 3 × 2
      expect(offline.items[1].productId).toBe('prod-round_58');
      expect(offline.items[1].costPrice).toBe(2);
      expect(offline.items[2].productId).toBe('prod-__MAGNET_SALE__');
      expect(offline.items[2].costPrice).toBeUndefined();             // anchor: no phantom COGS
    });

    it('uses the seller\'s EDITED cost for COGS, not the placeholder', async () => {
      const { svc, orders } = build({ products: [{ id: 'prod-sq_2', name: '2x2', sku: 'sq_2', costPrice: 1.75 }] });
      await svc.ingestMagnet(TENANT, 'key-1', 'branch-1', magnetSale());
      const offline = orders.create.mock.calls[0][2];
      expect(offline.items[0].costPrice).toBe(1.75);                  // seller's number, not 2
    });

    it('maps tender cash → CASH and online → QR_PH, carrying the provider_ref', async () => {
      const online = build();
      await online.svc.ingestMagnet(TENANT, 'key-1', 'branch-1', magnetSale());
      const onlineOffline = online.orders.create.mock.calls[0][2];
      expect(onlineOffline.payments[0].method).toBe('QR_PH');
      expect(onlineOffline.payments[0].reference).toBe('gc_123');

      const cash = build();
      await cash.svc.ingestMagnet(TENANT, 'key-1', 'branch-1',
        magnetSale({ tender: { type: 'cash' } }));
      const cashOffline = cash.orders.create.mock.calls[0][2];
      expect(cashOffline.payments[0].method).toBe('CASH');
      expect(cashOffline.payments[0].amount).toBe(230.5);
    });

    it('is a no-op on re-delivery of the same order_ref', async () => {
      const { svc, orders } = build({
        existingReceipt: { resultJson: { orderId: 'ord-1', orderNumber: 'ORD-2026-000001', tender: 'online' } },
      });
      const res = await svc.ingestMagnet(TENANT, 'key-1', 'branch-1', magnetSale());
      expect(res.replayed).toBe(true);
      expect(orders.create).not.toHaveBeenCalled();
    });

    it('rejects a sale whose lines do not add up to the total, posting nothing', async () => {
      const { svc, orders, prisma } = build();
      await expect(svc.ingestMagnet(TENANT, 'key-1', 'branch-1',
        magnetSale({ totals: { amount_minor: 99999, currency: 'PHP' } }),
      )).rejects.toBeInstanceOf(BadRequestException);
      expect(orders.create).not.toHaveBeenCalled();
      expect(prisma.ingestReceipt.create).not.toHaveBeenCalled();
    });

    it('rejects a sale with no lines or no currency', async () => {
      const { svc, orders } = build();
      await expect(svc.ingestMagnet(TENANT, 'key-1', 'branch-1',
        magnetSale({ lines: [], totals: { amount_minor: 0, currency: 'PHP' } }),
      )).rejects.toBeInstanceOf(BadRequestException);
      await expect(svc.ingestMagnet(TENANT, 'key-1', 'branch-1',
        magnetSale({ totals: { amount_minor: 23050, currency: '' } }),
      )).rejects.toBeInstanceOf(BadRequestException);
      expect(orders.create).not.toHaveBeenCalled();
    });

    it('rejects a sale or refund whose currency is not the shop\'s own, posting nothing', async () => {
      const { svc, orders, journal, prisma } = build();     // tenant currency PHP
      await expect(svc.ingestMagnet(TENANT, 'key-1', 'branch-1',
        magnetSale({ totals: { amount_minor: 23050, currency: 'USD' } }),
      )).rejects.toBeInstanceOf(BadRequestException);
      await expect(svc.ingestMagnet(TENANT, 'key-1', 'branch-1',
        magnetRefund({ totals: { amount_minor: 5000, currency: 'USD' } }),
      )).rejects.toBeInstanceOf(BadRequestException);
      expect(orders.create).not.toHaveBeenCalled();
      expect(journal.create).not.toHaveBeenCalled();
      expect(prisma.ingestReceipt.create).not.toHaveBeenCalled();
      // Case-insensitive: 'php' is still PHP.
      await svc.ingestMagnet(TENANT, 'key-1', 'branch-1',
        magnetSale({ totals: { amount_minor: 23050, currency: 'php' } }));
      expect(orders.create).toHaveBeenCalledTimes(1);
    });

    it('rejects fractional minor units, a zero/negative total, and a missing tender', async () => {
      const { svc, orders } = build();
      await expect(svc.ingestMagnet(TENANT, 'key-1', 'branch-1',
        magnetSale({
          lines: [{ description: 'x', qty: 1, unit_price_minor: 100.5, amount_minor: 100.5 }],
          totals: { amount_minor: 100.5, currency: 'PHP' },
        }),
      )).rejects.toBeInstanceOf(BadRequestException);
      await expect(svc.ingestMagnet(TENANT, 'key-1', 'branch-1',
        magnetSale({
          lines: [{ description: 'x', qty: 1, unit_price_minor: 0, amount_minor: 0 }],
          totals: { amount_minor: 0, currency: 'PHP' },
        }),
      )).rejects.toBeInstanceOf(BadRequestException);
      await expect(svc.ingestMagnet(TENANT, 'key-1', 'branch-1',
        magnetSale({ tender: undefined as any }),
      )).rejects.toBeInstanceOf(BadRequestException);
      expect(orders.create).not.toHaveBeenCalled();
    });

    it('posts a cash-sale refund as DR 4116 / CR 1010, balanced, with NO VAT line', async () => {
      const { svc, journal, prisma } = build();
      // The refund's own key is unseen; the original sale's receipt says cash.
      prisma.ingestReceipt.findUnique = jest.fn().mockImplementation(({ where }: any) =>
        Promise.resolve(where.tenantId_idempotencyKey.idempotencyKey === 'mm:sale:MM-1001'
          ? { resultJson: { orderId: 'ord-1', orderNumber: 'ORD-2026-000001', tender: 'cash' } }
          : null));

      await svc.ingestMagnet(TENANT, 'key-1', 'branch-1', magnetRefund());

      expect(journal.create).toHaveBeenCalledTimes(1);
      const [tenantId, dto, createdBy, source] = journal.create.mock.calls[0];
      expect(tenantId).toBe(TENANT);
      expect(createdBy).toBe('MAGNETMOMENTS');
      expect(source).toBe('SYSTEM');
      expect(dto.lines).toHaveLength(2);
      const codes = dto.lines.map((l: any) => l.accountId);
      expect(codes).toContain('acct-4116');               // refunds contra-income (debit)
      expect(codes).toContain('acct-1010');               // cash on hand (credit)
      expect(codes).not.toContain('acct-2020');           // gross books — no VAT reversal
      expect(codes).not.toContain('acct-1031');
      const debit  = dto.lines.reduce((s: number, l: any) => s + (l.debit ?? 0), 0);
      const credit = dto.lines.reduce((s: number, l: any) => s + (l.credit ?? 0), 0);
      expect(Math.round(debit * 100)).toBe(Math.round(credit * 100));
      expect(Math.round(credit * 100)).toBe(5000);        // ₱50 returned
    });

    it('credits 1031 for an online sale, and when the original sale is unknown', async () => {
      const online = build();
      online.prisma.ingestReceipt.findUnique = jest.fn().mockImplementation(({ where }: any) =>
        Promise.resolve(where.tenantId_idempotencyKey.idempotencyKey === 'mm:sale:MM-1001'
          ? { resultJson: { orderId: 'ord-1', orderNumber: 'ORD-2026-000001', tender: 'online' } }
          : null));
      await online.svc.ingestMagnet(TENANT, 'key-1', 'branch-1', magnetRefund());
      const onlineCodes = online.journal.create.mock.calls[0][1].lines.map((l: any) => l.accountId);
      expect(onlineCodes).toEqual(['acct-4116', 'acct-1031']);

      const unknown = build();                            // findUnique → null for every key
      await unknown.svc.ingestMagnet(TENANT, 'key-1', 'branch-1', magnetRefund({ order_ref: 'MM-GHOST' }));
      const dto = unknown.journal.create.mock.calls[0][1];
      expect(dto.lines.map((l: any) => l.accountId)).toEqual(['acct-4116', 'acct-1031']);
      expect(dto.description).toContain('original sale not found');
    });

    it('namespaces the idempotency keys as mm:sale:… / mm:refund:… and stores the tender', async () => {
      const { svc, prisma } = build();
      const res = await svc.ingestMagnet(TENANT, 'key-1', 'branch-1', magnetSale());
      expect(res.idempotencyKey).toBe('mm:sale:MM-1001');
      expect(prisma.ingestReceipt.create).toHaveBeenCalledTimes(1);
      const data = prisma.ingestReceipt.create.mock.calls[0][0].data;
      expect(data.idempotencyKey).toBe('mm:sale:MM-1001');
      expect(data.source).toBe('magnetmoments');
      expect(data.resultJson).toMatchObject({ orderId: 'ord-1', tender: 'online' });

      const refundRes = await svc.ingestMagnet(TENANT, 'key-1', 'branch-1', magnetRefund());
      expect(refundRes.idempotencyKey).toBe('mm:refund:MMR-1');
    });
  });
});
