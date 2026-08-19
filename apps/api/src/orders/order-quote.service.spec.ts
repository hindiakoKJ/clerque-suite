import { BadRequestException } from '@nestjs/common';
import { OrderQuoteService } from './order-quote.service';
import { TaxCalculatorService } from '../tax/tax.service';

/**
 * Pricing is the boundary between Clerque and every app that calls it: the
 * consumer describes what is being sold, we decide what it costs. These
 * tests use the REAL TaxCalculatorService — the point is that the quote a
 * booking app receives is the same arithmetic the till performs, not a
 * second implementation that agrees today and drifts next sprint.
 */
describe('OrderQuoteService', () => {
  const TENANT = 'tenant-1';

  const build = (opts: {
    taxStatus?: 'VAT' | 'NON_VAT' | 'UNREGISTERED';
    products?:  any[];
    variants?:  any[];
    options?:   any[];
  } = {}) => {
    const prisma = {
      tenant: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          taxStatus: opts.taxStatus ?? 'VAT',
        }),
      },
      product:         { findMany: jest.fn().mockResolvedValue(opts.products ?? []) },
      productVariant:  { findMany: jest.fn().mockResolvedValue(opts.variants ?? []) },
      modifierOption:  { findMany: jest.fn().mockResolvedValue(opts.options  ?? []) },
    } as any;
    return {
      prisma,
      svc: new OrderQuoteService(prisma, new TaxCalculatorService()),
    };
  };

  const PANDESAL = { id: 'p1', name: 'Pandesal', price: 112, isVatable: true };

  /* ── VAT math ────────────────────────────────────────────────────────── */

  it('splits VAT out of a VAT-inclusive price (₱112 → ₱100 net + ₱12 VAT)', async () => {
    const { svc } = build({ taxStatus: 'VAT', products: [PANDESAL] });
    const q = await svc.quote(TENANT, { items: [{ productId: 'p1', quantity: 1 }] });

    expect(q.subtotal).toBe(112);
    expect(q.vatAmount).toBe(12);
    expect(q.totalAmount).toBe(112);
  });

  it('reports zero VAT for a NON_VAT tenant on the same catalog', async () => {
    const { svc } = build({ taxStatus: 'NON_VAT', products: [PANDESAL] });
    const q = await svc.quote(TENANT, { items: [{ productId: 'p1', quantity: 1 }] });

    expect(q.vatAmount).toBe(0);
    expect(q.totalAmount).toBe(112);
  });

  it('multiplies by quantity', async () => {
    const { svc } = build({ products: [PANDESAL] });
    const q = await svc.quote(TENANT, { items: [{ productId: 'p1', quantity: 3 }] });

    expect(q.subtotal).toBe(336);
    expect(q.lines[0].lineTotal).toBe(336);
  });

  /* ── PWD / SC (RA 9994 / RA 7277) ────────────────────────────────────── */

  it('applies the PWD/SC discount on the VAT-exclusive base, then re-adds VAT', async () => {
    // ₱112 gross → ₱100 net → 20% off = ₱80 net → +12% VAT = ₱89.60.
    const { svc } = build({ taxStatus: 'VAT', products: [PANDESAL] });
    const q = await svc.quote(TENANT, {
      items: [{ productId: 'p1', quantity: 1 }],
      isPwdScDiscount: true,
    });

    expect(q.totalAmount).toBe(89.6);
    expect(q.vatAmount).toBe(9.6);
    expect(q.discountAmount).toBe(22.4);
    expect(q.isPwdScDiscount).toBe(true);
  });

  it('takes the PWD/SC discount straight off gross for a NON_VAT tenant', async () => {
    const { svc } = build({ taxStatus: 'NON_VAT', products: [PANDESAL] });
    const q = await svc.quote(TENANT, {
      items: [{ productId: 'p1', quantity: 1 }],
      isPwdScDiscount: true,
    });

    expect(q.totalAmount).toBe(89.6);
    expect(q.vatAmount).toBe(0);
  });

  /* ── Variants and modifiers ──────────────────────────────────────────── */

  it("uses the variant's price when it overrides the product's", async () => {
    const { svc } = build({
      products: [PANDESAL],
      variants: [{ id: 'v1', name: 'Large', price: 150, productId: 'p1' }],
    });
    const q = await svc.quote(TENANT, {
      items: [{ productId: 'p1', variantId: 'v1', quantity: 1 }],
    });

    expect(q.lines[0].unitPrice).toBe(150);
    expect(q.lines[0].productName).toBe('Pandesal (Large)');
  });

  it('falls back to the product price when the variant has none', async () => {
    const { svc } = build({
      products: [PANDESAL],
      variants: [{ id: 'v1', name: 'Sesame', price: null, productId: 'p1' }],
    });
    const q = await svc.quote(TENANT, {
      items: [{ productId: 'p1', variantId: 'v1', quantity: 1 }],
    });

    expect(q.lines[0].unitPrice).toBe(112);
  });

  it('adds modifier price adjustments to the unit price, before quantity', async () => {
    const { svc } = build({
      products: [PANDESAL],
      options: [
        { id: 'o1', name: 'Extra cheese', priceAdjustment: 20, modifierGroupId: 'g1', group: { name: 'Add-ons' } },
      ],
    });
    const q = await svc.quote(TENANT, {
      items: [{ productId: 'p1', quantity: 2, modifierOptionIds: ['o1'] }],
    });

    expect(q.lines[0].unitPrice).toBe(132);
    expect(q.lines[0].lineTotal).toBe(264);
    expect(q.lines[0].modifiers[0].optionName).toBe('Extra cheese');
  });

  it('rejects modifiers that would push the unit price below zero', async () => {
    const { svc } = build({
      products: [PANDESAL],
      options: [
        { id: 'o1', name: 'Bad discount', priceAdjustment: -500, modifierGroupId: 'g1', group: { name: 'X' } },
      ],
    });
    await expect(
      svc.quote(TENANT, { items: [{ productId: 'p1', quantity: 1, modifierOptionIds: ['o1'] }] }),
    ).rejects.toThrow(BadRequestException);
  });

  /* ── Tenant isolation + input validation ─────────────────────────────── */

  it("refuses a product that isn't in the caller's tenant", async () => {
    // The tenant filter is in the WHERE clause, so another tenant's product
    // simply does not come back — and an unresolved id is a hard failure,
    // never a silently-skipped line.
    const { svc } = build({ products: [] });
    await expect(
      svc.quote(TENANT, { items: [{ productId: 'other-tenant-product', quantity: 1 }] }),
    ).rejects.toThrow(/not found, inactive, or not in your organization/);
  });

  it("refuses a variant that belongs to a different product", async () => {
    const { svc } = build({
      products: [PANDESAL],
      variants: [{ id: 'v1', name: 'Large', price: 150, productId: 'SOME-OTHER-PRODUCT' }],
    });
    await expect(
      svc.quote(TENANT, { items: [{ productId: 'p1', variantId: 'v1', quantity: 1 }] }),
    ).rejects.toThrow(/does not belong to this product/);
  });

  it('scopes every catalog lookup to the calling tenant', async () => {
    const { svc, prisma } = build({
      products: [PANDESAL],
      variants: [{ id: 'v1', name: 'L', price: 150, productId: 'p1' }],
      options:  [{ id: 'o1', name: 'X', priceAdjustment: 0, modifierGroupId: 'g1', group: { name: 'G' } }],
    });
    await svc.quote(TENANT, {
      items: [{ productId: 'p1', variantId: 'v1', quantity: 1, modifierOptionIds: ['o1'] }],
    });

    expect(prisma.product.findMany.mock.calls[0][0].where.tenantId).toBe(TENANT);
    expect(prisma.productVariant.findMany.mock.calls[0][0].where.product.tenantId).toBe(TENANT);
    expect(prisma.modifierOption.findMany.mock.calls[0][0].where.group.tenantId).toBe(TENANT);
  });

  it('rejects an empty cart', async () => {
    const { svc } = build();
    await expect(svc.quote(TENANT, { items: [] })).rejects.toThrow(BadRequestException);
  });

  it('rejects a zero or negative quantity', async () => {
    const { svc } = build({ products: [PANDESAL] });
    await expect(
      svc.quote(TENANT, { items: [{ productId: 'p1', quantity: 0 }] }),
    ).rejects.toThrow(/quantity must be greater than zero/);
    await expect(
      svc.quote(TENANT, { items: [{ productId: 'p1', quantity: -5 }] }),
    ).rejects.toThrow(/quantity must be greater than zero/);
  });

  it('does not query for variants or modifiers when no line uses them', async () => {
    const { svc, prisma } = build({ products: [PANDESAL] });
    await svc.quote(TENANT, { items: [{ productId: 'p1', quantity: 1 }] });

    expect(prisma.productVariant.findMany).not.toHaveBeenCalled();
    expect(prisma.modifierOption.findMany).not.toHaveBeenCalled();
  });
});
