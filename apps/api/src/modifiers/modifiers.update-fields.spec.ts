import { NotFoundException } from '@nestjs/common';
import { ModifiersService } from './modifiers.service';

/**
 * Modifier edits write only the fields an owner edits (tenant isolation
 * check, 21 Oct 2026, finding K2).
 *
 * The edit bodies are plain interfaces, which the global validation pipe
 * cannot see, so the whole body reached the database: a body tenantId moved a
 * group into another shop, and a body modifierGroupId moved an add-on into
 * another shop's group -- where it showed on that shop's till at any price.
 */
const TENANT = 't-cafe';
const GROUP  = 'g-milk';
const OPTION = 'o-oat';

function build() {
  const prisma: any = {
    modifierGroup: {
      findFirst:  jest.fn().mockResolvedValue({ id: GROUP, tenantId: TENANT }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUnique: jest.fn().mockResolvedValue({ id: GROUP }),
    },
    modifierOption: {
      findFirst:  jest.fn().mockResolvedValue({ id: OPTION, modifierGroupId: GROUP }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUnique: jest.fn().mockResolvedValue({ id: OPTION }),
    },
    category: {
      findFirst: jest.fn(({ where }: any) => Promise.resolve(where.tenantId === TENANT && where.id === 'cat-hot' ? { id: 'cat-hot' } : null)),
    },
  };
  return { svc: new ModifiersService(prisma), prisma };
}

describe('ModifiersService.updateGroup', () => {
  it('never writes a tenantId, id or any other field from the body', async () => {
    const { svc, prisma } = build();
    await svc.updateGroup(TENANT, GROUP, { name: 'Milk', tenantId: 't-other-shop', id: 'g-x', createdAt: 'now' } as any);
    expect(prisma.modifierGroup.updateMany).toHaveBeenCalledWith({
      where: { id: GROUP, tenantId: TENANT },
      data:  { name: 'Milk' },
    });
  });

  it('refuses another shop\'s category and writes nothing', async () => {
    const { svc, prisma } = build();
    await expect(svc.updateGroup(TENANT, GROUP, { categoryId: 'cat-other-shop' })).rejects.toThrow(NotFoundException);
    expect(prisma.modifierGroup.updateMany).not.toHaveBeenCalled();
  });

  it('still edits every editable field, binds this shop\'s category, and unbinds with null', async () => {
    const { svc, prisma } = build();
    const edit = { name: 'Milk', required: true, multiSelect: false, minSelect: 1, maxSelect: null, sortOrder: 2, isActive: true, categoryId: 'cat-hot' };
    await svc.updateGroup(TENANT, GROUP, edit);
    expect(prisma.modifierGroup.updateMany.mock.calls[0][0].data).toEqual(edit);
    await svc.updateGroup(TENANT, GROUP, { categoryId: null });
    expect(prisma.modifierGroup.updateMany.mock.calls[1][0].data).toEqual({ categoryId: null });
  });
});

describe('ModifiersService.updateOption', () => {
  it('never moves an option into another group from the body', async () => {
    const { svc, prisma } = build();
    await svc.updateOption(TENANT, GROUP, OPTION, { modifierGroupId: 'g-other-shop', name: 'FREE', priceAdjustment: -100 } as any);
    expect(prisma.modifierOption.updateMany).toHaveBeenCalledWith({
      where: { id: OPTION, modifierGroupId: GROUP, group: { tenantId: TENANT } },
      data:  { name: 'FREE', priceAdjustment: -100 },
    });
  });

  it('still edits every editable field, as the recipe screen does', async () => {
    const { svc, prisma } = build();
    await svc.updateOption(TENANT, GROUP, OPTION, { recipeMultiplier: 1.25 });
    expect(prisma.modifierOption.updateMany.mock.calls[0][0].data).toEqual({ recipeMultiplier: 1.25 });
    const edit = { name: 'Oat', priceAdjustment: 30, isDefault: false, sortOrder: 1, isActive: true, recipeMultiplier: 1 };
    await svc.updateOption(TENANT, GROUP, OPTION, edit);
    expect(prisma.modifierOption.updateMany.mock.calls[1][0].data).toEqual(edit);
  });
});
