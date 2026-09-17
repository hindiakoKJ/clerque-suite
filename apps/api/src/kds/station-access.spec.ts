import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { stationContext, StationCaller } from './station-access';

/**
 * Who may use a station screen's tools. A kitchen tablet reads and writes only
 * its own station; the customer display and unpaired screens are refused; a
 * screen paired by someone who has since left may still read but not write.
 */
describe('stationContext', () => {
  function build(over: { pairerActive?: boolean; personBranch?: string | null; stationBranch?: string | null; branches?: Array<{ id: string; name: string }> } = {}) {
    const stations = [
      { id: 's-kitchen', tenantId: 't1', name: 'Kitchen', kind: 'KITCHEN', branchId: over.stationBranch === undefined ? null : over.stationBranch },
      { id: 's-bar', tenantId: 't1', name: 'Bar', kind: 'BAR', branchId: null },
    ];
    const users = [
      { id: 'mgr', tenantId: 't1', name: 'Anne', branchId: over.personBranch === undefined ? 'b-main' : over.personBranch, isActive: over.pairerActive ?? true },
    ];
    const branches = over.branches ?? [{ id: 'b-main', name: 'Main' }, { id: 'b-first', name: 'First' }];
    const prisma: any = {
      station: { findFirst: jest.fn(({ where }: any) => Promise.resolve(stations.find((s) => s.id === where.id && s.tenantId === where.tenantId) ?? null)) },
      user:    { findFirst: jest.fn(({ where }: any) => Promise.resolve(users.find((u) => u.id === where.id && u.tenantId === where.tenantId) ?? null)) },
      branch:  {
        findFirst: jest.fn(({ where }: any) => Promise.resolve(
          where.id ? branches.find((b) => b.id === where.id) ?? null : branches.find((b) => b.id === 'b-first') ?? null,
        )),
      },
    };
    return prisma;
  }
  const device = (over: Partial<StationCaller> = {}) =>
    ({ sub: 'mgr', tenantId: 't1', branchId: null, isDevice: true, deviceRole: 'KDS_KITCHEN', stationId: 's-kitchen', role: 'KIOSK_DISPLAY', ...over }) as StationCaller;
  const login = (over: Partial<StationCaller> = {}) =>
    ({ sub: 'mgr', tenantId: 't1', branchId: 'b-main', role: 'GENERAL_EMPLOYEE', ...over }) as StationCaller;

  it('lets a kitchen display use its own station, for the branch of whoever paired it', async () => {
    const ctx = await stationContext(build(), device(), 's-kitchen', { write: true });
    expect(ctx).toEqual({
      tenantId: 't1', station: { id: 's-kitchen', name: 'Kitchen', kind: 'KITCHEN' }, branch: { id: 'b-main', name: 'Main' },
      actorId: 'mgr', actorLabel: 'Kitchen screen', isDevice: true,
    });
  });

  it('refuses a display paired to another station', async () => {
    await expect(stationContext(build(), device(), 's-bar', { write: false })).rejects.toThrow(new ForbiddenException('This screen is paired to another station.'));
  });

  it('refuses a display paired to no station', async () => {
    await expect(stationContext(build(), device({ stationId: null }), 's-kitchen', { write: false }))
      .rejects.toThrow(new ForbiddenException('This screen is not paired to a station. Pair it again from Settings > Displays.'));
  });

  it('refuses the customer display', async () => {
    const prisma = build();
    await expect(stationContext(prisma, device({ deviceRole: 'CUSTOMER_DISPLAY', stationId: 's-kitchen' }), 's-kitchen', { write: false }))
      .rejects.toThrow(new ForbiddenException('Only a kitchen or bar display can use this.'));
    expect(prisma.station.findFirst).not.toHaveBeenCalled();
  });

  it('refuses a write when the person who paired the screen is no longer active, but still lets it read', async () => {
    await expect(stationContext(build({ pairerActive: false }), device(), 's-kitchen', { write: true }))
      .rejects.toThrow(new ForbiddenException('The person who paired this screen no longer has an active account. Pair it again.'));
    await expect(stationContext(build({ pairerActive: false }), device(), 's-kitchen', { write: false })).resolves.toMatchObject({ actorId: 'mgr' });
    await expect(stationContext(build({ pairerActive: false }), login(), 's-kitchen', { write: true }))
      .rejects.toThrow(new ForbiddenException('Your account is not active.'));
  });

  it('refuses a station of another shop', async () => {
    await expect(stationContext(build(), login({ tenantId: 't2' }), 's-kitchen', { write: false })).rejects.toThrow(NotFoundException);
  });

  it('gives a person with no branch the station\'s branch, then the shop\'s first branch', async () => {
    const onStation = await stationContext(build({ personBranch: null, stationBranch: 'b-main' }), login({ branchId: null }), 's-kitchen', { write: false });
    expect(onStation.branch).toEqual({ id: 'b-main', name: 'Main' });
    const first = await stationContext(build({ personBranch: null, stationBranch: null }), login({ branchId: null }), 's-kitchen', { write: false });
    expect(first.branch).toEqual({ id: 'b-first', name: 'First' });
    await expect(stationContext(build({ personBranch: null, branches: [] }), login({ branchId: null }), 's-kitchen', { write: false }))
      .rejects.toThrow(BadRequestException);
  });

  it('names a logged-in person by their name, and a login\'s own branch wins over the account\'s', async () => {
    const ctx = await stationContext(build({ personBranch: 'b-first' }), login({ branchId: 'b-main' }), 's-kitchen', { write: true });
    expect(ctx.actorLabel).toBe('Anne');
    expect(ctx.isDevice).toBe(false);
    expect(ctx.branch.id).toBe('b-main');
  });
});
