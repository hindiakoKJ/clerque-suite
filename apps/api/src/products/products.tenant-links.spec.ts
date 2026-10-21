import { ForbiddenException } from '@nestjs/common';
import { ProductsService } from './products.service';
import { ProductsController } from './products.controller';

/**
 * Ids a product links to must be this shop's own (tenant isolation check,
 * 21 Oct 2026, finding P1).
 *
 * A recipe line, a category or a unit naming another shop's id was written
 * as it came. The product then read that shop's row back -- an ingredient
 * with its purchase price and stock, or a whole category -- and a recipe line
 * pointing at the other shop's ingredient blocked that shop's backup
 * restore. A branch id in the products list or till query read another
 * shop's live stock the same way.
 *
 * The stand-in database below holds this shop's rows only; any other id is
 * another shop's.
 */
const TENANT = 't-mine';
const MINE = {
  rawMaterial:   new Set(['rm-milk', 'rm-beans']),
  category:      new Set(['cat-coffee']),
  unitOfMeasure: new Set(['uom-cup']),
  branch:        new Set(['b-main', 'b-annex']),
};
const ownRow = (set: Set<string>) =>
  jest.fn(({ where }: any) => Promise.resolve(where.tenantId === TENANT && set.has(where.id) ? { id: where.id } : null));

function build() {
  const prisma: any = {
    tenant:   { findUnique: jest.fn().mockResolvedValue({ planCode: 'CLERQUE', showPurchaseCostsToStaff: true }) },
    product: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'p-latte', tenantId: TENANT, name: 'Latte', price: 150, costPrice: 40, isVatable: true,
        inventoryMode: 'UNIT_BASED', bomItems: [], category: null, variants: [], modifierGroups: [],
      }),
      count:  jest.fn().mockResolvedValue(0),
      create: jest.fn(({ data }: any) => Promise.resolve({ id: 'p-new', ...data })),
      update: jest.fn(({ data }: any) => Promise.resolve({ id: 'p-latte', ...data })),
      findMany: jest.fn().mockResolvedValue([]),
    },
    productVariant: { findFirst: jest.fn().mockResolvedValue({ id: 'v-large', productId: 'p-latte' }) },
    rawMaterial: {
      findMany: jest.fn(({ where }: any) => Promise.resolve(
        where.category !== undefined || where.tenantId !== TENANT
          ? []
          : where.id.in.filter((id: string) => MINE.rawMaterial.has(id)).map((id: string) => ({ id, costPrice: 0.25 })),
      )),
    },
    category:      { findFirst: ownRow(MINE.category) },
    unitOfMeasure: { findFirst: ownRow(MINE.unitOfMeasure) },
    branch:        { findFirst: ownRow(MINE.branch) },
    bomItem:        { deleteMany: jest.fn(), createMany: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    variantBomItem: { deleteMany: jest.fn(), createMany: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn((fn: any) => fn(prisma)),
  };
  return { svc: new ProductsService(prisma), prisma };
}

const NEW_PRODUCT = { name: 'Iced Latte', price: 150, costPrice: 40 } as any;

describe('ProductsService.create -- links are this shop\'s own', () => {
  it('refuses a recipe line naming another shop\'s ingredient, and writes nothing', async () => {
    const { svc, prisma } = build();
    await expect(svc.create(TENANT, {
      ...NEW_PRODUCT, bomItems: [{ rawMaterialId: 'rm-milk', quantity: 200 }, { rawMaterialId: 'rm-other-shop', quantity: 10 }],
    })).rejects.toThrow(new ForbiddenException('That ingredient is not in your shop.'));
    expect(prisma.product.create).not.toHaveBeenCalled();
  });

  it('refuses another shop\'s category or unit', async () => {
    const { svc, prisma } = build();
    await expect(svc.create(TENANT, { ...NEW_PRODUCT, categoryId: 'cat-other' }))
      .rejects.toThrow(new ForbiddenException('That category is not in your shop.'));
    await expect(svc.create(TENANT, { ...NEW_PRODUCT, unitOfMeasureId: 'uom-other' }))
      .rejects.toThrow(new ForbiddenException('That unit is not in your shop.'));
    expect(prisma.product.create).not.toHaveBeenCalled();
  });

  it('still creates a product with this shop\'s recipe, category and unit', async () => {
    const { svc, prisma } = build();
    await svc.create(TENANT, {
      ...NEW_PRODUCT, categoryId: 'cat-coffee', unitOfMeasureId: 'uom-cup',
      bomItems: [{ rawMaterialId: 'rm-milk', quantity: 200 }, { rawMaterialId: 'rm-beans', quantity: 18 }],
    });
    const data = prisma.product.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ tenantId: TENANT, categoryId: 'cat-coffee', unitOfMeasureId: 'uom-cup', inventoryMode: 'RECIPE_BASED' });
    expect(data.bomItems.create.map((b: any) => b.rawMaterialId)).toEqual(['rm-milk', 'rm-beans']);
  });

  it('asks nothing extra of a plain product with no category or unit', async () => {
    const { svc, prisma } = build();
    await svc.create(TENANT, NEW_PRODUCT);
    expect(prisma.category.findFirst).not.toHaveBeenCalled();
    expect(prisma.unitOfMeasure.findFirst).not.toHaveBeenCalled();
    expect(prisma.product.create).toHaveBeenCalled();
  });
});

describe('ProductsService.update -- category and unit', () => {
  it('refuses another shop\'s category or unit before writing', async () => {
    const { svc, prisma } = build();
    await expect(svc.update(TENANT, 'p-latte', { categoryId: 'cat-other' } as any, 'BUSINESS_OWNER'))
      .rejects.toThrow(ForbiddenException);
    await expect(svc.update(TENANT, 'p-latte', { unitOfMeasureId: 'uom-other' } as any, 'BUSINESS_OWNER'))
      .rejects.toThrow(ForbiddenException);
    expect(prisma.product.update).not.toHaveBeenCalled();
  });

  it('still moves a product to this shop\'s category, or clears it with null', async () => {
    const { svc, prisma } = build();
    await svc.update(TENANT, 'p-latte', { categoryId: 'cat-coffee', unitOfMeasureId: 'uom-cup' } as any, 'BUSINESS_OWNER');
    expect(prisma.product.update.mock.calls[0][0].data).toMatchObject({ categoryId: 'cat-coffee', unitOfMeasureId: 'uom-cup' });
    await svc.update(TENANT, 'p-latte', { categoryId: null } as any, 'BUSINESS_OWNER');
    expect(prisma.product.update.mock.calls[1][0].data.categoryId).toBeNull();
  });
});

describe('ProductsService.saveBom / saveVariantBom -- recipe lines', () => {
  it('refuses another shop\'s ingredient and leaves the recipe on file alone', async () => {
    const { svc, prisma } = build();
    await expect(svc.saveBom(TENANT, 'p-latte', [{ rawMaterialId: 'rm-other-shop', quantity: 1 }]))
      .rejects.toThrow(new ForbiddenException('That ingredient is not in your shop.'));
    expect(prisma.bomItem.deleteMany).not.toHaveBeenCalled();
    expect(prisma.bomItem.createMany).not.toHaveBeenCalled();
  });

  it('still saves a recipe of this shop\'s ingredients, costed from them', async () => {
    const { svc, prisma } = build();
    await svc.saveBom(TENANT, 'p-latte', [{ rawMaterialId: 'rm-milk', quantity: 200 }, { rawMaterialId: 'rm-beans', quantity: 18 }]);
    expect(prisma.bomItem.createMany.mock.calls[0][0].data.map((b: any) => b.rawMaterialId)).toEqual(['rm-milk', 'rm-beans']);
    // 218 units at 0.25 each.
    expect(Number(prisma.product.update.mock.calls[0][0].data.costPrice)).toBeCloseTo(54.5, 4);
  });

  it('refuses another shop\'s ingredient on a size\'s recipe', async () => {
    const { svc, prisma } = build();
    await expect(svc.saveVariantBom(TENANT, 'p-latte', 'v-large', [{ rawMaterialId: 'rm-milk', quantity: 300 }, { rawMaterialId: 'rm-other-shop', quantity: 1 }]))
      .rejects.toThrow(new ForbiddenException('That ingredient is not in your shop.'));
    expect(prisma.variantBomItem.deleteMany).not.toHaveBeenCalled();
    expect(prisma.variantBomItem.createMany).not.toHaveBeenCalled();
  });

  it('still saves a size\'s recipe of this shop\'s ingredients', async () => {
    const { svc, prisma } = build();
    await svc.saveVariantBom(TENANT, 'p-latte', 'v-large', [{ rawMaterialId: 'rm-milk', quantity: 300 }]);
    expect(prisma.variantBomItem.createMany.mock.calls[0][0].data[0]).toMatchObject({ variantId: 'v-large', rawMaterialId: 'rm-milk' });
  });
});

describe('GET /products and GET /products/pos -- the branch in the query', () => {
  const user = { sub: 'u1', tenantId: TENANT, branchId: 'b-main', role: 'BUSINESS_OWNER' } as any;
  const controller = () => {
    const { prisma } = build();
    const products: any = { findAll: jest.fn().mockResolvedValue([]), findForPos: jest.fn().mockResolvedValue([]) };
    return { ctrl: new ProductsController(products, {} as any, prisma), products, prisma };
  };

  it('refuses another shop\'s branch before reading any stock', async () => {
    const { ctrl, products } = controller();
    await expect(ctrl.findAll(user, undefined, 'b-other')).rejects.toThrow(ForbiddenException);
    await expect(ctrl.findForPos(user, 'b-other')).rejects.toThrow(ForbiddenException);
    expect(products.findAll).not.toHaveBeenCalled();
    expect(products.findForPos).not.toHaveBeenCalled();
  });

  it('still reads another branch of this shop', async () => {
    const { ctrl, products } = controller();
    await ctrl.findAll(user, undefined, 'b-annex');
    await ctrl.findForPos(user, 'b-annex');
    expect(products.findAll).toHaveBeenCalledWith(TENANT, false, 'b-annex');
    expect(products.findForPos).toHaveBeenCalledWith(TENANT, 'b-annex', undefined);
  });

  it('needs no lookup for the caller\'s own branch or no branch at all', async () => {
    const { ctrl, products, prisma } = controller();
    await ctrl.findForPos(user, 'b-main');
    await ctrl.findAll(user);
    expect(prisma.branch.findFirst).not.toHaveBeenCalled();
    expect(products.findForPos).toHaveBeenCalledWith(TENANT, 'b-main', undefined);
    expect(products.findAll).toHaveBeenCalledWith(TENANT, false, 'b-main');
  });
});
