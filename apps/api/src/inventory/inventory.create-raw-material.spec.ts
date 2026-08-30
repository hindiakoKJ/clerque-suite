import { BadRequestException } from '@nestjs/common';
import { InventoryService } from './inventory.service';

/**
 * Adding an ingredient in the app.
 *
 * Two things were wrong here, and both only showed up once a kitchen arrived.
 *
 * The reorder level was accepted by the form, carried in the DTO, and then
 * dropped: the create wrote name, unit, category and cost and nothing else. So
 * EVERY ingredient added through the app was unmonitored — and Procure's Check
 * stock only ever looks at items that have a reorder level, so none of them
 * could appear on a buy list no matter how low they ran.
 *
 * And the unit was taken as written. Rice bought by the sack and portioned by
 * the gram made a recipe cost a thousand times too much; measured on real
 * data, a ₱220 dish costing ₱48,000 with 0 producible.
 */
describe('InventoryService.createRawMaterial', () => {
  const TENANT = 't1';

  function build() {
    const created: any[] = [];
    const prisma: any = {
      rawMaterial: {
        create: jest.fn(({ data }: any) => {
          created.push(data);
          return Promise.resolve({ id: 'rm-1', ...data });
        }),
      },
    };
    const periods = { assertDateIsOpen: jest.fn() };
    return { svc: new InventoryService(prisma, periods as any) as any, created };
  }

  it('stores the reorder level instead of discarding it', async () => {
    const { svc, created } = build();
    await svc.createRawMaterial(TENANT, {
      name: 'Jasmine Rice', unit: 'g', costPrice: 0.065, lowStockAlert: 2000,
    });
    expect(Number(created[0].lowStockAlert)).toBe(2000);
  });

  it('leaves the reorder level unset when none was given', async () => {
    // Not the same as zero: zero would mean "tell me when it is gone", and
    // writing that for someone who left the box blank invents a policy.
    const { svc, created } = build();
    await svc.createRawMaterial(TENANT, { name: 'Sesame Seeds', unit: 'g' });
    expect(created[0].lowStockAlert).toBeUndefined();
  });

  it('stores the recipe unit and the converted cost, not what was typed', async () => {
    // Bought at ₱320/kg, cooked in grams. Without this the recipe reads 150
    // and charges 150 x 320.
    const { svc, created } = build();
    await svc.createRawMaterial(TENANT, {
      name: 'Beef Brisket', unit: 'kg', costPrice: 320, recipeUnit: 'g',
    });
    expect(created[0].unit).toBe('g');
    expect(Number(created[0].costPrice)).toBeCloseTo(0.32, 6);
  });

  it('uses the pack size when the units do not convert on their own', async () => {
    const { svc, created } = build();
    await svc.createRawMaterial(TENANT, {
      name: 'Soy Sauce', unit: 'pc', costPrice: 150, recipeUnit: 'ml', packSize: 750,
    });
    expect(created[0].unit).toBe('ml');
    expect(Number(created[0].costPrice)).toBeCloseTo(0.2, 6);
  });

  it('refuses rather than guessing when it cannot get between the units', async () => {
    const { svc } = build();
    await expect(svc.createRawMaterial(TENANT, {
      name: 'Rice', unit: 'sack', costPrice: 1400, recipeUnit: 'g',
    })).rejects.toThrow(BadRequestException);
  });

  it('names the two units and asks for the pack size, rather than saying "invalid"', async () => {
    const { svc } = build();
    await expect(svc.createRawMaterial(TENANT, {
      name: 'Rice', unit: 'sack', costPrice: 1400, recipeUnit: 'g',
    })).rejects.toThrow(/how many g are in one sack/i);
  });

  it('writes nothing at all when the units are refused', async () => {
    // A half-created ingredient at the wrong unit is worse than no ingredient:
    // stock gets counted into it before anyone notices.
    const { svc, created } = build();
    await expect(svc.createRawMaterial(TENANT, {
      name: 'Rice', unit: 'sack', costPrice: 1400, recipeUnit: 'g',
    })).rejects.toThrow();
    expect(created).toHaveLength(0);
  });

  it('leaves an ordinary ingredient exactly as it was before any of this', async () => {
    const { svc, created } = build();
    await svc.createRawMaterial(TENANT, {
      name: 'Espresso Beans', unit: 'g', costPrice: 1.85, category: 'INGREDIENT',
    });
    expect(created[0].unit).toBe('g');
    expect(Number(created[0].costPrice)).toBe(1.85);
    expect(created[0].category).toBe('INGREDIENT');
  });
});
