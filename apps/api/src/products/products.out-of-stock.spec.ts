import { ProductsService } from './products.service';

/**
 * Selling a product the system believes has no stock.
 *
 * The POS grid disables any tile whose `isOutOfStock` is true. That is right
 * for a settled shop and wrong for one still setting up: a cafe whose recipes
 * are entered but whose ingredient counts are not sees its ENTIRE menu greyed
 * out, so cashiers can neither train nor trade.
 *
 * Tenant.allowSaleWhenOutOfStock lifts the block. What it must NOT do is lie:
 * maxProducible and the low-stock badge still report the real position.
 */
describe('ProductsService — sell when out of stock', () => {
  const TENANT = 't1';
  const BRANCH = 'br-1';
  const LATTE = 'p-latte';
  const MILK = 'rm-milk';

  function build(allowSaleWhenOutOfStock: boolean, milkStock: number) {
    const prisma: any = {
      tenant: {
        findUnique: jest.fn().mockResolvedValue({ allowSaleWhenOutOfStock }),
      },
      customer: { findFirst: jest.fn().mockResolvedValue(null) },
      priceListItem: { findMany: jest.fn().mockResolvedValue([]) },
      product: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: LATTE,
            name: 'Latte',
            price: 139,
            isActive: true,
            inventoryMode: 'RECIPE_BASED',
            inventory: [],
            bomItems: [{ rawMaterialId: MILK, quantity: 150 }],
            variants: [],
            modifierGroups: [],
          },
        ]),
      },
      rawMaterialInventory: {
        findMany: jest.fn().mockResolvedValue([{ rawMaterialId: MILK, quantity: milkStock }]),
      },
    };
    return new ProductsService(prisma as any);
  }

  it('blocks an unstocked recipe product by default', async () => {
    const svc = build(false, 0);
    const [latte] = await svc.findForPos(TENANT, BRANCH);

    expect(latte.maxProducible).toBe(0);
    expect(latte.isOutOfStock).toBe(true);   // grid disables the tile
  });

  it('keeps it sellable when the owner opts in', async () => {
    const svc = build(true, 0);
    const [latte] = await svc.findForPos(TENANT, BRANCH);

    expect(latte.isOutOfStock).toBe(false);  // grid leaves the tile enabled
    // ...but the real position is still reported, so badges and reports do
    // not start lying just because the block was lifted.
    expect(latte.maxProducible).toBe(0);
    expect(latte.isLowStock).toBe(true);
  });

  it('changes nothing for a product that is actually in stock', async () => {
    const stocked = build(true, 3_000);   // 3000ml / 150ml = 20 cups
    const [a] = await stocked.findForPos(TENANT, BRANCH);
    expect(a.maxProducible).toBe(20);
    expect(a.isOutOfStock).toBe(false);

    const blocked = build(false, 3_000);
    const [b] = await blocked.findForPos(TENANT, BRANCH);
    expect(b.maxProducible).toBe(20);
    expect(b.isOutOfStock).toBe(false);
  });
});
