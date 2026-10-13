import { pricesBelowMenu, type Catalog, type SoldLine } from './price-check';
import { OrdersService } from './orders.service';

/**
 * The till sends each line's price and the server books it as sent. These are
 * the sales an owner must hear about -- and the honest ones that must stay quiet.
 */

const catalog = (over: Partial<Catalog> = {}): Catalog => ({
  productPrice: new Map([['latte', 150], ['croissant', 100]]),
  variants:     new Map([['latte-16oz', { productId: 'latte', price: 170 }], ['latte-same', { productId: 'latte', price: null }]]),
  optionPrice:  new Map([['oat', 30], ['shot', 30]]),
  promos:       new Map([
    ['happy-hour', { isActive: true, discountPercent: 20, fixedPrice: null, appliesToAll: false, productIds: new Set(['latte']) }],
    ['croissant-99', { isActive: true, discountPercent: null, fixedPrice: 80, appliesToAll: false, productIds: new Set(['croissant']) }],
    ['ended', { isActive: false, discountPercent: 50, fixedPrice: null, appliesToAll: true, productIds: new Set() }],
  ]),
  ...over,
});

const latte = (over: Partial<SoldLine> = {}): SoldLine => ({
  productId: 'latte', productName: 'Cafe Latte', unitPrice: 150, quantity: 1, discountAmount: 0, ...over,
});

describe('honest sales raise nothing', () => {
  it('menu price', () => {
    expect(pricesBelowMenu([latte()], catalog())).toEqual([]);
  });
  it('a size with its own price, and add-ons added on top', () => {
    expect(pricesBelowMenu([latte({ variantId: 'latte-16oz', unitPrice: 230, modifiers: [{ modifierOptionId: 'oat' }, { modifierOptionId: 'shot' }] })], catalog())).toEqual([]);
  });
  it('a size without a price of its own uses the product price', () => {
    expect(pricesBelowMenu([latte({ variantId: 'latte-same' })], catalog())).toEqual([]);
  });
  it('a real promo, as the till computes it (20% of the line; down to a fixed price)', () => {
    expect(pricesBelowMenu([
      latte({ quantity: 2, discountAmount: 60, promoId: 'happy-hour' }),
      { productId: 'croissant', productName: 'Croissant', unitPrice: 100, quantity: 3, discountAmount: 60, promoId: 'croissant-99' },
    ], catalog())).toEqual([]);
  });
  it('a price ABOVE menu is not the owner losing money', () => {
    expect(pricesBelowMenu([latte({ unitPrice: 160 })], catalog())).toEqual([]);
  });
  it('a product or add-on that is gone from the catalog is skipped, not guessed', () => {
    expect(pricesBelowMenu([latte({ productId: 'deleted', unitPrice: 1 })], catalog())).toEqual([]);
    expect(pricesBelowMenu([latte({ unitPrice: 1, modifiers: [{ modifierOptionId: 'gone' }] })], catalog())).toEqual([]);
  });
});

describe('tampered sales are flagged', () => {
  it('a ₱150 latte rung at ₱50', () => {
    expect(pricesBelowMenu([latte({ unitPrice: 50 })], catalog())).toEqual([
      { productName: 'Cafe Latte', quantity: 1, soldAt: 50, menuPrice: 150, why: 'BELOW_MENU' },
    ]);
  });
  it('an add-on charged but priced below its menu', () => {
    const [f] = pricesBelowMenu([latte({ unitPrice: 150, modifiers: [{ modifierOptionId: 'oat' }] })], catalog());
    expect(f).toMatchObject({ why: 'BELOW_MENU', menuPrice: 180 });
  });
  it('a discount with no promo behind it', () => {
    const [f] = pricesBelowMenu([latte({ discountAmount: 100 })], catalog());
    expect(f).toMatchObject({ why: 'DISCOUNT_WITHOUT_PROMO', soldAt: 50, menuPrice: 150 });
  });
  it('a real promo stretched past what it gives', () => {
    const [f] = pricesBelowMenu([latte({ discountAmount: 100, promoId: 'happy-hour' })], catalog());
    expect(f).toMatchObject({ why: 'DISCOUNT_WITHOUT_PROMO', soldAt: 50, menuPrice: 120 });
  });
  it('an ended promo, or one for another product', () => {
    expect(pricesBelowMenu([latte({ discountAmount: 75, promoId: 'ended' })], catalog())).toHaveLength(1);
    expect(pricesBelowMenu([latte({ discountAmount: 20, promoId: 'croissant-99' })], catalog())).toHaveLength(1);
  });
});

describe('the sale itself is never touched', () => {
  function build(prismaOver: any = {}) {
    const audit = { log: jest.fn() };
    const telegram = { pricesBelowMenu: jest.fn() };
    const prisma: any = {
      product:        { findMany: jest.fn().mockResolvedValue([{ id: 'latte', price: 150 }]) },
      productVariant: { findMany: jest.fn().mockResolvedValue([]) },
      modifierOption: { findMany: jest.fn().mockResolvedValue([]) },
      promotion:      { findMany: jest.fn().mockResolvedValue([]) },
      user:           { findMany: jest.fn().mockResolvedValue([{ id: 'owner-1' }]) },
      notification:   { createMany: jest.fn() },
      ...prismaOver,
    };
    const svc: any = Object.create(OrdersService.prototype);
    svc.prisma = prisma; svc.audit = audit; svc.telegramAlerts = telegram;
    return { svc, prisma, audit, telegram };
  }
  const items: any[] = [{ productId: 'latte', productName: 'Cafe Latte', unitPrice: 50, quantity: 1, discountAmount: 0, modifiers: [] }];

  it('a flagged sale goes to the audit log, the owner\'s bell and Telegram', async () => {
    const { svc, prisma, audit, telegram } = build();
    await svc.flagPricesBelowMenu('t-1', 'o-1', 'ORD-2026-000200', 'cashier-1', items);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'PRICE_ADJUSTED', entityType: 'Order', entityId: 'o-1', performedBy: 'cashier-1',
      description: expect.stringContaining('Cafe Latte at 50.00 (menu 150.00)'),
    }));
    expect(prisma.notification.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ userId: 'owner-1', kind: 'WARNING', title: 'Sold below menu price: ORD-2026-000200' })],
    });
    expect(telegram.pricesBelowMenu).toHaveBeenCalledWith('t-1', 'o-1', [expect.objectContaining({ why: 'BELOW_MENU' })]);
  });

  it('an honest sale writes nothing', async () => {
    const { svc, audit, telegram } = build();
    await svc.flagPricesBelowMenu('t-1', 'o-1', 'ORD-1', 'cashier-1', [{ ...items[0], unitPrice: 150 }]);
    expect(audit.log).not.toHaveBeenCalled();
    expect(telegram.pricesBelowMenu).not.toHaveBeenCalled();
  });

  it('a failure in the check is swallowed: the sale is already saved', async () => {
    const { svc } = build({ product: { findMany: jest.fn().mockRejectedValue(new Error('db down')) } });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(svc.flagPricesBelowMenu('t-1', 'o-1', 'ORD-1', 'cashier-1', items)).resolves.toBeUndefined();
    warn.mockRestore();
  });
});

describe('the owner\'s Telegram alert', () => {
  const { priceBelowMenuMessage } = require('../telegram/messages');
  const base = {
    shopName: 'Cafe Carolina', branchName: null, orderNumber: 'ORD-2026-000200', cashierName: 'Ana',
    rungAt: new Date('2026-10-13T06:00:00Z'),
    flags: [{ productName: 'Cafe Latte', quantity: 1, soldAt: 50, menuPrice: 150, why: 'BELOW_MENU' }],
  };

  it('names the sale, the item, what it sold at and the menu price', () => {
    const text: string = priceBelowMenuMessage({ ...base, late: false });
    expect(text).toContain('Sold below menu: ORD-2026-000200');
    expect(text).toContain('Cafe Latte');
    expect(text).toMatch(/sold at\s+50\.00/);
    expect(text).toMatch(/menu price\s+150\.00/);
    expect(text).toContain('Check this sale with the cashier.');
  });

  it('says so when the sale was rung up offline and may carry an old price', () => {
    expect(priceBelowMenuMessage({ ...base, late: true })).toContain('the till may have had an old price');
  });
});
