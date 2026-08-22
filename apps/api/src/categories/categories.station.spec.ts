import { NotFoundException } from '@nestjs/common';
import { CategoriesService } from './categories.service';

/**
 * Routing a category to a prep station.
 *
 * Category.stationId decides which kitchen/bar screen an item queues to, but
 * neither DTO carried the field — so only the built-in coffee-shop seeder
 * could ever set it, and then only for its own 15 fixed category names. A
 * café that imported its real menu got categories that routed nowhere, and
 * nothing appeared on the Bar or Kitchen displays at all.
 */
describe('CategoriesService — station routing', () => {
  const TENANT = 't1';
  const STATION = 'st-bar';

  let prisma: any;
  let svc: CategoriesService;

  beforeEach(() => {
    prisma = {
      category: {
        findFirst: jest.fn().mockResolvedValue({ id: 'cat-1', tenantId: TENANT }),
        create:    jest.fn(({ data }: any) => Promise.resolve({ id: 'cat-new', ...data })),
        update:    jest.fn(({ data }: any) => Promise.resolve({ id: 'cat-1', ...data })),
      },
      station: {
        // Only this tenant's station resolves.
        findFirst: jest.fn(({ where }: any) =>
          Promise.resolve(where.id === STATION && where.tenantId === TENANT ? { id: STATION } : null),
        ),
      },
    };
    svc = new CategoriesService(prisma as any);
  });

  it('routes a category to a station on create', async () => {
    const out = await svc.create(TENANT, { name: 'Signature Coffee', stationId: STATION } as any);
    expect(out.stationId).toBe(STATION);
  });

  it('routes an existing category to a station on update', async () => {
    const out = await svc.update(TENANT, 'cat-1', { stationId: STATION } as any);
    expect(out.stationId).toBe(STATION);
  });

  it('rejects a station that belongs to another business', async () => {
    await expect(
      svc.update(TENANT, 'cat-1', { stationId: 'someone-elses-station' } as any),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.category.update).not.toHaveBeenCalled();
  });

  it('allows clearing the route with null', async () => {
    const out = await svc.update(TENANT, 'cat-1', { stationId: null } as any);
    expect(out.stationId).toBeNull();
    // No station lookup is needed to unroute.
    expect(prisma.station.findFirst).not.toHaveBeenCalled();
  });

  it('leaves routing untouched when the field is absent', async () => {
    await svc.update(TENANT, 'cat-1', { name: 'Renamed' } as any);
    expect(prisma.station.findFirst).not.toHaveBeenCalled();
    expect(prisma.category.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { name: 'Renamed' } }),
    );
  });
});
