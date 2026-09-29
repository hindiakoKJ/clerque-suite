/**
 * ModifiersService.deleteOption — an option that is on past receipts is
 * hidden, not deleted.
 *
 * OrderItemModifier.modifierOption is a required relation with no onDelete,
 * so a hard delete of an option that was ever sold fails at the database
 * (P2003 → 400 "The referenced record does not exist.") and the owner saw
 * only "Failed to delete option". Every read path filters options on
 * isActive, so hiding it has the same effect on the till and keeps the
 * receipts whole.
 */
import { NotFoundException } from '@nestjs/common';
import { ModifiersService } from './modifiers.service';

const TENANT = 't1';
const GROUP  = 'g-milk';
const OPTION = 'o-oat';

function makePrismaMock() {
  return {
    modifierGroup:     { findFirst: jest.fn() },
    modifierOption:    { findFirst: jest.fn(), deleteMany: jest.fn(), updateMany: jest.fn() },
    orderItemModifier: { count: jest.fn() },
  };
}

describe('ModifiersService.deleteOption', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let service: ModifiersService;

  beforeEach(() => {
    prisma  = makePrismaMock();
    service = new ModifiersService(prisma as any);
    prisma.modifierGroup.findFirst.mockResolvedValue({ id: GROUP, tenantId: TENANT });
    prisma.modifierOption.findFirst.mockResolvedValue({ id: OPTION, modifierGroupId: GROUP });
  });

  it('deletes an option that was never sold', async () => {
    prisma.orderItemModifier.count.mockResolvedValue(0);
    prisma.modifierOption.deleteMany.mockResolvedValue({ count: 1 });

    await expect(service.deleteOption(TENANT, GROUP, OPTION)).resolves.toEqual({ id: OPTION });

    expect(prisma.modifierOption.deleteMany).toHaveBeenCalledWith({
      where: { id: OPTION, modifierGroupId: GROUP, group: { tenantId: TENANT } },
    });
    expect(prisma.modifierOption.updateMany).not.toHaveBeenCalled();
  });

  it('hides an option that is on past receipts instead of deleting it', async () => {
    prisma.orderItemModifier.count.mockResolvedValue(3);
    prisma.modifierOption.updateMany.mockResolvedValue({ count: 1 });

    await expect(service.deleteOption(TENANT, GROUP, OPTION))
      .resolves.toEqual({ id: OPTION, isActive: false });

    expect(prisma.modifierOption.updateMany).toHaveBeenCalledWith({
      where: { id: OPTION, modifierGroupId: GROUP, group: { tenantId: TENANT } },
      data:  { isActive: false },
    });
    // The receipts keep their line: nothing is deleted.
    expect(prisma.modifierOption.deleteMany).not.toHaveBeenCalled();
  });

  it('404s for a group of another tenant before touching anything', async () => {
    prisma.modifierGroup.findFirst.mockResolvedValue(null);

    await expect(service.deleteOption(TENANT, GROUP, OPTION)).rejects.toThrow(NotFoundException);

    expect(prisma.orderItemModifier.count).not.toHaveBeenCalled();
    expect(prisma.modifierOption.deleteMany).not.toHaveBeenCalled();
    expect(prisma.modifierOption.updateMany).not.toHaveBeenCalled();
  });
});
