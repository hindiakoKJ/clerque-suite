/**
 * ModifiersService.setOptionIngredients — saving a swap ("Oatmilk": the
 * drink's milk out, Oatside in, at the drink's own amount).
 *
 * The amounts of a swap are decided at the sale, from each drink's recipe, so
 * a swapped-out line is stored without an amount and only the line that goes
 * in carries one: what a drink with no milk gets.
 */
import { ConflictException } from '@nestjs/common';
import { ModifiersService } from './modifiers.service';

const TENANT = 't1';
const GROUP = 'g-milk';
const OPTION = 'o-oat';
const UNITS: Record<string, string> = { fresh: 'ml', breve: 'ml', oat: 'ml', beans: 'g' };

function setup() {
  const createMany = jest.fn().mockResolvedValue({ count: 0 });
  const prisma: any = {
    modifierGroup: { findFirst: jest.fn().mockResolvedValue({ id: GROUP, tenantId: TENANT }) },
    modifierOption: { findFirst: jest.fn().mockResolvedValue({ id: OPTION, modifierGroupId: GROUP }) },
    rawMaterial: {
      findMany: jest.fn(({ where }: any) => Promise.resolve(where.id.in.map((id: string) => ({ id, unit: UNITS[id] })))),
    },
    $transaction: jest.fn(async (cb: (tx: any) => Promise<unknown>) => cb({
      modifierOptionIngredient: { deleteMany: jest.fn(), createMany },
      modifierOption: { findUnique: jest.fn().mockResolvedValue({ id: OPTION, ingredients: [] }) },
    })),
  };
  return { service: new ModifiersService(prisma), createMany };
}
const line = (rawMaterialId: string, quantity: number, role?: 'ADD' | 'SWAP_OUT' | 'SWAP_IN') =>
  ({ rawMaterialId, quantity, unit: UNITS[rawMaterialId], ...(role ? { role } : {}) });

describe('saving a swap on an add-on option', () => {
  it('stores the swapped-out milks without an amount and the oat milk with its no-milk amount', async () => {
    const { service, createMany } = setup();
    await service.setOptionIngredients(TENANT, GROUP, OPTION, [
      line('fresh', 0, 'SWAP_OUT'), line('breve', 0, 'SWAP_OUT'), line('oat', 30, 'SWAP_IN'),
    ]);
    const rows = createMany.mock.calls[0][0].data;
    expect(rows.map((r: any) => [r.rawMaterialId, r.quantity, r.role])).toEqual([
      ['fresh', 0, 'SWAP_OUT'], ['breve', 0, 'SWAP_OUT'], ['oat', 30, 'SWAP_IN'],
    ]);
  });

  it('keeps plain lines as they were: ADD, negatives allowed', async () => {
    const { service, createMany } = setup();
    await service.setOptionIngredients(TENANT, GROUP, OPTION, [line('fresh', -200), line('oat', 200)]);
    expect(createMany.mock.calls[0][0].data.map((r: any) => [r.rawMaterialId, r.quantity, r.role]))
      .toEqual([['fresh', -200, 'ADD'], ['oat', 200, 'ADD']]);
  });

  it('refuses a swap with nothing to put in, two things to put in, or a different unit', async () => {
    const { service } = setup();
    await expect(service.setOptionIngredients(TENANT, GROUP, OPTION, [line('fresh', 0, 'SWAP_OUT')]))
      .rejects.toBeInstanceOf(ConflictException);
    await expect(service.setOptionIngredients(TENANT, GROUP, OPTION, [line('oat', 30, 'SWAP_IN'), line('breve', 30, 'SWAP_IN')]))
      .rejects.toBeInstanceOf(ConflictException);
    await expect(service.setOptionIngredients(TENANT, GROUP, OPTION, [line('beans', 0, 'SWAP_OUT'), line('oat', 30, 'SWAP_IN')]))
      .rejects.toThrow(/same unit/);
  });

  it('refuses a swapped-in amount of zero or less, and an unknown line kind', async () => {
    const { service } = setup();
    await expect(service.setOptionIngredients(TENANT, GROUP, OPTION, [line('fresh', 0, 'SWAP_OUT'), line('oat', 0, 'SWAP_IN')]))
      .rejects.toBeInstanceOf(ConflictException);
    await expect(service.setOptionIngredients(TENANT, GROUP, OPTION, [line('fresh', 0, 'SWAP_OUT'), line('oat', -5, 'SWAP_IN')]))
      .rejects.toBeInstanceOf(ConflictException);
    await expect(service.setOptionIngredients(TENANT, GROUP, OPTION, [{ ...line('oat', 30), role: 'REPLACE' as any }]))
      .rejects.toThrow(/Unknown line kind/);
  });
});
