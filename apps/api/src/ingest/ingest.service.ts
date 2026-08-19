import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OrdersService } from '../orders/orders.service';
import { JournalService } from '../accounting/journal.service';
import { AccountsService } from '../accounting/accounts.service';
import { TaxCalculatorService } from '../tax/tax.service';
import type { TaxStatus } from '../tax/tax.service';
import type { PaymentMethod, OfflineOrder } from '@repo/shared-types';
import {
  pesos,
  type CourtSideEvent,
  type CourtSideSaleEvent,
  type CourtSideRefundEvent,
  type CourtSideLineType,
} from './courtside.types';
import {
  minorToMajor,
  type MagnetEvent,
  type MagnetSaleEvent,
  type MagnetRefundEvent,
} from './magnetmoments.types';

import { MAGNET_CATALOG, MAGNET_CATEGORY, MAGNET_GENERIC } from './magnet-catalog';

/** A resolved magnet product: id + name + the cost that drives COGS (null = no COGS). */
type MagnetProduct = { id: string; name: string; costPrice: number | null };

/** CourtSide line type → the seeded { category, revenueAccount, product SKU }. */
const COURT_STREAMS: Record<CourtSideLineType, { category: string; account: string; sku: string; productName: string }> = {
  court_time:       { category: 'Court Rental', account: '4110', sku: '__COURT_TIME__',       productName: 'Court Rental' },
  open_play_seat:   { category: 'Open Play',    account: '4111', sku: '__OPEN_PLAY_SEAT__',   productName: 'Open Play Seat' },
  tournament_entry: { category: 'Tournament',   account: '4112', sku: '__TOURNAMENT_ENTRY__', productName: 'Tournament Entry' },
};

/** CourtSide tender channel → Clerque PaymentMethod. All non-cash settle to 1031. */
function mapTender(type: string, channel: string): PaymentMethod {
  if (type === 'cash') return 'CASH';
  switch ((channel || '').toLowerCase()) {
    case 'gcash': return 'GCASH_BUSINESS';
    case 'maya':  return 'MAYA_BUSINESS';
    case 'qrph':  return 'QR_PH';
    // 'card' and anything else: no CARD member in the shared PaymentMethod
    // union yet, so route to QR_PH — still a non-cash digital tender (→ 1031),
    // which is what matters for the books and the settlement reconciliation.
    default:      return 'QR_PH';
  }
}

@Injectable()
export class IngestService {
  private readonly logger = new Logger(IngestService.name);

  constructor(
    private readonly prisma:  PrismaService,
    private readonly orders:  OrdersService,
    private readonly journal: JournalService,
    private readonly accounts: AccountsService,
    private readonly tax:     TaxCalculatorService,
  ) {}

  /**
   * Ingest one CourtSide event for a club tenant. Idempotent: a re-delivery of
   * the same idempotency key returns the stored result and does nothing else.
   */
  async ingest(
    tenantId:        string,
    apiKeyId:        string | null,
    branchId:        string | null,
    event:           CourtSideEvent,
  ): Promise<{ idempotencyKey: string; replayed: boolean; result: unknown }> {
    const idempotencyKey = this.keyFor(event);

    // Fast path: already processed.
    const existing = await this.prisma.ingestReceipt.findUnique({
      where: { tenantId_idempotencyKey: { tenantId, idempotencyKey } },
    });
    if (existing) {
      return { idempotencyKey, replayed: true, result: existing.resultJson };
    }

    const result = event.event_type === 'sale'
      ? await this.handleSale(tenantId, apiKeyId, branchId, event)
      : await this.handleRefund(tenantId, event);

    // Record the receipt. If a concurrent delivery beat us to it, the unique
    // constraint fires — re-read and return that result (still a no-op net).
    try {
      await this.prisma.ingestReceipt.create({
        data: {
          tenantId,
          idempotencyKey,
          source:    'courtside',
          eventType: event.event_type,
          resultOrderId: (result as { orderId?: string }).orderId ?? null,
          resultJson: result as Prisma.InputJsonValue,
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const row = await this.prisma.ingestReceipt.findUnique({
          where: { tenantId_idempotencyKey: { tenantId, idempotencyKey } },
        });
        return { idempotencyKey, replayed: true, result: row?.resultJson ?? result };
      }
      throw e;
    }

    return { idempotencyKey, replayed: false, result };
  }

  private keyFor(event: CourtSideEvent): string {
    // The contract's keys are sale:<order_id> / refund:<refund_id>. We key on
    // the human refs CourtSide sends; they are stable per financial fact.
    if (event.event_type === 'sale')   return `sale:${event.order_ref}`;
    return `refund:${event.refund_ref}`;
  }

  // ─── Sale ────────────────────────────────────────────────────────────────

  private async handleSale(
    tenantId: string,
    apiKeyId: string | null,
    branchId: string | null,
    event:    CourtSideSaleEvent,
  ): Promise<{ orderId: string; orderNumber: string; revenueByAccount: Record<string, number> }> {
    if (!event.lines?.length) {
      throw new BadRequestException('CourtSide sale has no lines.');
    }

    const resolvedBranchId = branchId ?? await this.firstBranchId(tenantId);
    if (!resolvedBranchId) {
      throw new BadRequestException('Club tenant has no branch to post the sale against.');
    }

    // Ensure the per-stream service products exist (idempotent), so revenue
    // routes to the three distinct income accounts via category.
    const productByType = await this.ensureCourtProducts(tenantId, resolvedBranchId);

    const taxStatus = await this.tenantTaxStatus(tenantId);

    // Build the order lines from the CourtSide lines. CourtSide is the price
    // authority (the money is already collected via Xendit), so we DO NOT
    // recompute from the catalog — the seeded product prices are 0 and exist
    // only to carry the revenue account.
    let subtotal = 0, vatTotal = 0;
    const items = event.lines.map((l) => {
      const product = productByType[l.type];
      if (!product) throw new BadRequestException(`Unknown CourtSide line type: ${l.type}`);
      const lineTotal = pesos(l.amount_centavos);       // VAT-inclusive
      const brk = this.tax.computeTaxBreakdown(lineTotal, taxStatus);
      subtotal += lineTotal;
      vatTotal += brk.vatAmount;
      return {
        productId:      product.id,
        productName:    l.description || product.name,
        unitPrice:      pesos(l.unit_price_centavos),
        quantity:       l.qty,
        discountAmount: 0,
        vatAmount:      brk.vatAmount,
        lineTotal,
        isVatable:      taxStatus === 'VAT',
      };
    });

    const total = pesos(event.totals.net_centavos);
    // Keep the order VAT consistent with the sum of the line VATs the handler
    // will use to split revenue — never a separately-rounded figure.
    const vatAmount = Math.round(vatTotal * 100) / 100;

    const method = mapTender(event.tender.type, event.tender.channel);

    const offline: OfflineOrder = {
      clientUuid:      `courtside:${event.order_ref}`,
      branchId:        resolvedBranchId,
      items,
      payments:        [{ method, amount: total, reference: event.tender.provider_ref ?? undefined }],
      discounts:       [],
      subtotal:        Math.round(subtotal * 100) / 100,
      discountAmount:  0,
      vatAmount,
      totalAmount:     total,
      isPwdScDiscount: false,
      createdAt:       event.occurred_at,
      invoiceType:     'CASH_SALE',        // already paid — never a receivable
      customerName:    event.customer?.name || undefined,
    };

    const order = await this.orders.create(tenantId, null, offline, {
      channel:             'API',
      createdByApiKeyId:   apiKeyId,
      externalRef:         event.order_ref,
      // CourtSide owns the price of an already-paid sale — do NOT re-derive it
      // from the (zero-priced) catalog products, which would ORDER_TOTALS_MISMATCH.
      enforceServerTotals: false,
    });

    const revenueByAccount: Record<string, number> = {};
    for (const l of event.lines) {
      const acct = COURT_STREAMS[l.type].account;
      revenueByAccount[acct] = (revenueByAccount[acct] ?? 0) + pesos(l.amount_centavos);
    }

    return { orderId: order.id, orderNumber: order.orderNumber, revenueByAccount };
  }

  // ─── Refund ──────────────────────────────────────────────────────────────

  private async handleRefund(
    tenantId: string,
    event:    CourtSideRefundEvent,
  ): Promise<{ journalPosted: boolean; amount: number }> {
    // net_centavos arrives negative (money returned). Work with the magnitude.
    const refundTotal = Math.abs(pesos(event.totals.net_centavos));
    if (refundTotal <= 0) return { journalPosted: false, amount: 0 };

    const taxStatus = await this.tenantTaxStatus(tenantId);
    const brk = this.tax.computeTaxBreakdown(refundTotal, taxStatus);

    // Contra-income against the original sale, reversing revenue AND output VAT:
    //   DR 4116 Refunds & Cancellations   (net of VAT)
    //   DR 2020 Output VAT                (the VAT portion, reversed)
    //   CR 1031 Digital Wallet Receivable (total returned via the gateway)
    const [refunds, outputVat, digital] = await Promise.all([
      this.resolveAccountId(tenantId, '4116'),
      this.resolveAccountId(tenantId, '2020'),
      this.resolveAccountId(tenantId, '1031'),
    ]);

    await this.journal.create(
      tenantId,
      {
        date:        event.occurred_at,
        description: `CourtSide refund ${event.refund_ref} — ${event.reason || 'cancellation'} (order ${event.order_ref})`,
        reference:   event.refund_ref,
        lines: [
          { accountId: refunds,   debit:  brk.netAmount, description: 'Refund / cancellation' },
          ...(brk.vatAmount > 0
            ? [{ accountId: outputVat, debit: brk.vatAmount, description: 'Reverse output VAT' }]
            : []),
          { accountId: digital,   credit: refundTotal,   description: 'Refund to customer (digital)' },
        ],
      },
      'COURTSIDE',
      'SYSTEM',                          // bypasses posting control on 4116/2020
    );

    return { journalPosted: true, amount: refundTotal };
  }

  // ─── magnetmoments.cc (Magnet Books) ─────────────────────────────────────

  /**
   * Ingest one magnetmoments.cc event for a shop tenant. Same idempotency
   * story as CourtSide, on a namespaced key so a shop order_ref can never
   * collide with a club one in the same tenant.
   */
  async ingestMagnet(
    tenantId: string,
    apiKeyId: string | null,
    branchId: string | null,
    event:    MagnetEvent,
  ): Promise<{ idempotencyKey: string; replayed: boolean; result: unknown }> {
    const idempotencyKey = this.magnetKeyFor(event);

    const existing = await this.prisma.ingestReceipt.findUnique({
      where: { tenantId_idempotencyKey: { tenantId, idempotencyKey } },
    });
    if (existing) {
      return { idempotencyKey, replayed: true, result: existing.resultJson };
    }

    const result = event.event_type === 'sale'
      ? await this.handleMagnetSale(tenantId, apiKeyId, branchId, event)
      : await this.handleMagnetRefund(tenantId, event);

    try {
      await this.prisma.ingestReceipt.create({
        data: {
          tenantId,
          idempotencyKey,
          source:    'magnetmoments',
          eventType: event.event_type,
          resultOrderId: (result as { orderId?: string }).orderId ?? null,
          resultJson: result as Prisma.InputJsonValue,
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const row = await this.prisma.ingestReceipt.findUnique({
          where: { tenantId_idempotencyKey: { tenantId, idempotencyKey } },
        });
        return { idempotencyKey, replayed: true, result: row?.resultJson ?? result };
      }
      throw e;
    }

    return { idempotencyKey, replayed: false, result };
  }

  private magnetKeyFor(event: MagnetEvent): string {
    if (event.event_type === 'sale') return `mm:sale:${event.order_ref}`;
    return `mm:refund:${event.refund_ref}`;
  }

  private async handleMagnetSale(
    tenantId: string,
    apiKeyId: string | null,
    branchId: string | null,
    event:    MagnetSaleEvent,
  ): Promise<{ orderId: string; orderNumber: string; tender: 'cash' | 'online' | 'other'; amount: number }> {
    if (!event.lines?.length) {
      throw new BadRequestException('Magnet sale has no lines.');
    }
    if (!event.totals?.currency) {
      throw new BadRequestException('Magnet sale has no currency.');
    }
    if (!event.tender?.type) {
      throw new BadRequestException('Magnet sale has no tender.');
    }
    // Money is whole minor units — a fractional or missing centavo count is a
    // sender bug, not something to round past.
    const wholeMinor = (n: unknown) => Number.isInteger(n);
    if (
      !wholeMinor(event.totals.amount_minor) ||
      event.lines.some((l) => !wholeMinor(l.amount_minor) || !wholeMinor(l.unit_price_minor) || !wholeMinor(l.qty))
    ) {
      throw new BadRequestException('Magnet sale amounts must be whole minor units (centavos) and qty a whole number.');
    }
    if (event.totals.amount_minor <= 0) {
      throw new BadRequestException('Magnet sale total must be more than zero.');
    }
    // A magnet order must reconcile: the lines ARE the total.
    const linesSum = event.lines.reduce((s, l) => s + l.amount_minor, 0);
    if (linesSum !== event.totals.amount_minor) {
      throw new BadRequestException(
        `Magnet sale lines (${linesSum}) do not add up to the total (${event.totals.amount_minor}).`,
      );
    }
    await this.assertMagnetCurrency(tenantId, event.totals.currency);

    const resolvedBranchId = branchId ?? await this.firstBranchId(tenantId);
    if (!resolvedBranchId) {
      throw new BadRequestException('Shop tenant has no branch to post the sale against.');
    }

    // Per-SIZE products (one per magnetmoments preset, each with its own cost
    // and price) so each line routes to its real product and COGS posts at
    // that size's cost. Seeds the placeholder catalog on first contact; a line
    // with a missing/unknown sku falls back to the generic zero-cost anchor.
    const catalog = await this.ensureMagnetCatalog(tenantId);

    // The shop is the price authority (the money is already collected). Books
    // are GROSS — no VAT split — so every line is vatAmount 0 / not vatable.
    let subtotal = 0;
    const items = event.lines.map((l) => {
      const lineTotal = minorToMajor(l.amount_minor);
      subtotal += lineTotal;
      const product = (l.sku && catalog.bySku.get(l.sku)) || catalog.generic;
      return {
        productId:      product.id,
        productName:    l.description || product.name,
        // COGS snapshot: orders.create takes the cost from the LINE (the till
        // copies Product.costPrice into it), so stamp this size's cost here or
        // the sale can never relieve inventory. Generic anchor → null → no COGS.
        costPrice:      product.costPrice ?? undefined,
        unitPrice:      minorToMajor(l.unit_price_minor),
        quantity:       l.qty,
        discountAmount: 0,
        vatAmount:      0,
        lineTotal,
        isVatable:      false,
      };
    });

    const total  = minorToMajor(event.totals.amount_minor);
    const method: PaymentMethod = event.tender.type === 'cash' ? 'CASH' : 'QR_PH';

    const offline: OfflineOrder = {
      clientUuid:      `magnetmoments:${event.order_ref}`,
      branchId:        resolvedBranchId,
      items,
      payments:        [{ method, amount: total, reference: event.tender.provider_ref ?? undefined }],
      discounts:       [],
      subtotal:        Math.round(subtotal * 100) / 100,
      discountAmount:  0,
      vatAmount:       0,
      totalAmount:     total,
      isPwdScDiscount: false,
      createdAt:       event.occurred_at,
      invoiceType:     'CASH_SALE',        // already paid — never a receivable
      taxType:         'VAT_EXEMPT',       // books gross, no tax
      customerName:    event.customer?.name || undefined,
    };

    const order = await this.orders.create(tenantId, null, offline, {
      channel:             'API',
      createdByApiKeyId:   apiKeyId,
      externalRef:         event.order_ref,
      // The shop owns the price of an already-paid sale — do NOT re-derive it
      // from the (zero-priced) anchor product.
      enforceServerTotals: false,
    });

    // The tender is kept on the receipt so a later refund knows which cash
    // account to credit back.
    return { orderId: order.id, orderNumber: order.orderNumber, tender: event.tender.type, amount: total };
  }

  private async handleMagnetRefund(
    tenantId: string,
    event:    MagnetRefundEvent,
  ): Promise<{ journalPosted: boolean; amount: number }> {
    if (!event.totals?.currency) {
      throw new BadRequestException('Magnet refund has no currency.');
    }
    if (!Number.isInteger(event.totals.amount_minor)) {
      throw new BadRequestException('Magnet refund amount must be whole minor units (centavos).');
    }
    const refundTotal = Math.abs(minorToMajor(event.totals.amount_minor));
    if (refundTotal <= 0) return { journalPosted: false, amount: 0 };
    await this.assertMagnetCurrency(tenantId, event.totals.currency);

    // Which account gave the money back? Read the original sale's receipt.
    const saleReceipt = await this.prisma.ingestReceipt.findUnique({
      where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: `mm:sale:${event.order_ref}` } },
    });
    const saleTender = (saleReceipt?.resultJson as { tender?: string } | null)?.tender;
    const wasCash    = saleTender === 'cash';
    const note       = saleReceipt ? '' : ' (original sale not found — refund assumed digital)';

    // Books are gross: DR 4116 Refunds & Cancellations / CR the cash account.
    const [refunds, cashAcct] = await Promise.all([
      this.resolveAccountId(tenantId, '4116'),
      this.resolveAccountId(tenantId, wasCash ? '1010' : '1031'),
    ]);

    await this.journal.create(
      tenantId,
      {
        date:        event.occurred_at,
        description: `Magnet refund ${event.refund_ref} — ${event.reason || 'refund'} (order ${event.order_ref})${note}`,
        reference:   event.refund_ref,
        lines: [
          { accountId: refunds,  debit:  refundTotal, description: 'Refund / cancellation' },
          { accountId: cashAcct, credit: refundTotal, description: wasCash ? 'Refund to customer (cash)' : 'Refund to customer (digital)' },
        ],
      },
      'MAGNETMOMENTS',
      'SYSTEM',                          // bypasses posting control on 4116
    );

    return { journalPosted: true, amount: refundTotal };
  }

  /**
   * The shop's money must be in the tenant's own currency — the ledger has no
   * FX, so a USD sale landing in PHP books would simply be the wrong number.
   */
  private async assertMagnetCurrency(tenantId: string, currency: string): Promise<void> {
    const t = await this.prisma.tenant.findUnique({
      where: { id: tenantId }, select: { currency: true },
    });
    const tenantCurrency = (t?.currency ?? 'PHP').toUpperCase();
    if (currency.toUpperCase() !== tenantCurrency) {
      throw new BadRequestException(
        `Magnet event is in ${currency}, but this shop's books are kept in ${tenantCurrency}.`,
      );
    }
  }

  /**
   * Seed the placeholder magnet catalog for a tenant — one product per size
   * (each with its own placeholder cost + price) plus the generic anchor — and
   * return them keyed by sku. IDEMPOTENT and NON-DESTRUCTIVE: a product that
   * already exists (by sku) is returned as-is with the seller's own cost/price
   * — seeding never overwrites their edits. Public so the owner-facing
   * "seed my catalog" endpoint and the sale bridge share one implementation.
   */
  async ensureMagnetCatalog(tenantId: string): Promise<{
    bySku:   Map<string, MagnetProduct>;
    generic: MagnetProduct;
    created: number;
  }> {
    // Category carrying the revenue account (create if absent, correct if drifted).
    let category = await this.prisma.category.findFirst({
      where:  { tenantId, name: MAGNET_CATEGORY.name },
      select: { id: true, revenueAccountCode: true },
    });
    if (!category) {
      category = await this.prisma.category.create({
        data:   { tenantId, name: MAGNET_CATEGORY.name, revenueAccountCode: MAGNET_CATEGORY.revenueAccountCode },
        select: { id: true, revenueAccountCode: true },
      });
    } else if (category.revenueAccountCode !== MAGNET_CATEGORY.revenueAccountCode) {
      await this.prisma.category.update({
        where: { id: category.id },
        data:  { revenueAccountCode: MAGNET_CATEGORY.revenueAccountCode },
      });
    }

    const wantedSkus = [...MAGNET_CATALOG.map((c) => c.sku), MAGNET_GENERIC.sku];
    const existing = await this.prisma.product.findMany({
      where:  { tenantId, sku: { in: wantedSkus } },
      select: { id: true, name: true, sku: true, costPrice: true },
    });
    const bySku = new Map<string, MagnetProduct>();
    for (const p of existing) {
      if (p.sku) bySku.set(p.sku, { id: p.id, name: p.name, costPrice: p.costPrice != null ? Number(p.costPrice) : null });
    }

    let created = 0;
    for (const item of MAGNET_CATALOG) {
      if (bySku.has(item.sku)) continue;                 // seller's product wins
      const p = await this.prisma.product.create({
        data: {
          tenantId,
          categoryId:  category.id,
          name:        item.name,
          sku:         item.sku,
          description: item.description,
          price:       new Prisma.Decimal(item.price),      // placeholder — seller edits
          costPrice:   new Prisma.Decimal(item.costPrice),  // placeholder — drives COGS
          isVatable:   false,                               // books gross
          isActive:    true,
        },
        select: { id: true, name: true, sku: true, costPrice: true },
      });
      bySku.set(item.sku, { id: p.id, name: p.name, costPrice: Number(p.costPrice) });
      created++;
    }

    let generic = bySku.get(MAGNET_GENERIC.sku);
    if (!generic) {
      const p = await this.prisma.product.create({
        data: {
          tenantId, categoryId: category.id,
          name: MAGNET_GENERIC.name, sku: MAGNET_GENERIC.sku,
          // Zero-priced, zero-cost anchor for a line with no/unknown sku —
          // carries the revenue account only; no stock, no COGS.
          price: new Prisma.Decimal(0), costPrice: new Prisma.Decimal(0),
          isVatable: false, isActive: true,
        },
        select: { id: true, name: true },
      });
      generic = { id: p.id, name: p.name, costPrice: null };
      bySku.set(MAGNET_GENERIC.sku, generic);
      created++;
    } else {
      // The anchor must never carry a cost (it would post phantom COGS).
      generic = { ...generic, costPrice: null };
      bySku.set(MAGNET_GENERIC.sku, generic);
    }

    return { bySku, generic, created };
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  /** Find-or-create the three court service products + their categories. */
  private async ensureCourtProducts(
    tenantId: string,
    branchId: string,
  ): Promise<Record<CourtSideLineType, { id: string; name: string }>> {
    const out = {} as Record<CourtSideLineType, { id: string; name: string }>;

    for (const type of Object.keys(COURT_STREAMS) as CourtSideLineType[]) {
      const spec = COURT_STREAMS[type];

      let product = await this.prisma.product.findFirst({
        where:  { tenantId, sku: spec.sku },
        select: { id: true, name: true },
      });
      if (product) { out[type] = product; continue; }

      // Category carrying the revenue account (create if absent).
      let category = await this.prisma.category.findFirst({
        where:  { tenantId, name: spec.category },
        select: { id: true, revenueAccountCode: true },
      });
      if (!category) {
        category = await this.prisma.category.create({
          data: { tenantId, name: spec.category, revenueAccountCode: spec.account },
          select: { id: true, revenueAccountCode: true },
        });
      } else if (category.revenueAccountCode !== spec.account) {
        await this.prisma.category.update({
          where: { id: category.id },
          data:  { revenueAccountCode: spec.account },
        });
      }

      product = await this.prisma.product.create({
        data: {
          tenantId,
          categoryId: category.id,
          name:  spec.productName,
          sku:   spec.sku,
          // Zero-priced service anchor — the amount comes from CourtSide, and
          // this product's only job is to carry the revenue account. No stock.
          price: new Prisma.Decimal(0),
          isVatable: true,
          isActive:  true,
        },
        select: { id: true, name: true },
      });
      out[type] = product;
    }

    return out;
  }

  private async tenantTaxStatus(tenantId: string): Promise<TaxStatus> {
    const t = await this.prisma.tenant.findUnique({
      where: { id: tenantId }, select: { taxStatus: true },
    });
    return (t?.taxStatus ?? 'UNREGISTERED') as TaxStatus;
  }

  private async firstBranchId(tenantId: string): Promise<string | null> {
    const b = await this.prisma.branch.findFirst({
      where: { tenantId, isActive: true }, orderBy: { createdAt: 'asc' }, select: { id: true },
    });
    return b?.id ?? null;
  }

  private async resolveAccountId(tenantId: string, code: string): Promise<string> {
    const a = await this.accounts.findByCode(tenantId, code);
    if (!a) throw new BadRequestException(`Account ${code} not found in the club's chart of accounts.`);
    return a.id;
  }
}
