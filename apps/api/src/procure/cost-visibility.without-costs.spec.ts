import { Prisma } from '@prisma/client';
import { withoutCosts } from './cost-visibility';

/**
 * The product list, detail and barcode routes used to hand every make-cost
 * and each recipe ingredient's buying price to any signed-in account, while
 * only the till's own route was gated. This strips the tree.
 */
describe('withoutCosts', () => {
  const product = {
    id: 'p1', name: 'Americano', price: new Prisma.Decimal(80), costPrice: new Prisma.Decimal(25.9), costPriceIsDerived: true,
    createdAt: new Date('2026-09-23T00:00:00Z'),
    variants: [{ id: 'v1', name: 'Large', price: 95, costPrice: 30 }],
    bomItems: [
      { id: 'b1', quantity: 17, rawMaterial: { id: 'r1', name: 'Coffee Beans', unit: 'g', costPrice: 1.1, packCost: 550, lastCost: 1.05 } },
    ],
  };

  it('drops every cost figure, recipe ingredients included, and keeps the rest', () => {
    const out = withoutCosts(product) as any;
    expect(JSON.stringify(out)).not.toMatch(/costPrice|costPriceIsDerived|packCost|unitCost|lastCost/);
    expect(out.name).toBe('Americano');
    expect(out.price).toBe(product.price);              // Decimal passes through untouched
    expect(out.createdAt).toBe(product.createdAt);      // Date too
    expect(out.variants[0].price).toBe(95);
    expect(out.bomItems[0].quantity).toBe(17);
    expect(out.bomItems[0].rawMaterial.name).toBe('Coffee Beans');
  });

  it('handles a list, null and a plain value', () => {
    expect(JSON.stringify(withoutCosts([product]))).not.toMatch(/costPrice/);
    expect(withoutCosts(null)).toBeNull();
    expect(withoutCosts('x')).toBe('x');
  });

  it('does not touch the original object', () => {
    withoutCosts(product);
    expect((product as any).costPrice).toBeDefined();
    expect((product as any).bomItems[0].rawMaterial.costPrice).toBe(1.1);
  });
});
