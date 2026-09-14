import { KdsController } from './kds.controller';

/**
 * Prep levels on a station screen: who may read which station, and whose
 * branch it is. The customer display is paired too, and must not see
 * back-of-house stock; a kitchen tablet reads its own station, for the branch
 * of whoever paired it.
 */
describe('KdsController — prep levels', () => {
  function build() {
    const subRecipes: any = { stationPrep: jest.fn().mockResolvedValue({ rows: [] }) };
    const prisma: any = { user: { findFirst: jest.fn(({ where }: any) => Promise.resolve(where.tenantId === 't1' && where.id === 'mgr' ? { branchId: 'b-B' } : null)) } };
    return { ctl: new KdsController({} as never, subRecipes, prisma), subRecipes, prisma };
  }
  const device = (over: any) => ({ sub: 'mgr', tenantId: 't1', branchId: null, isDevice: true, deviceRole: 'KDS_KITCHEN', stationId: 's-kitchen', role: 'KIOSK_DISPLAY', ...over });

  it('a logged-in person reads with their own branch', async () => {
    const { ctl, subRecipes } = build();
    await ctl.prep({ sub: 'u1', tenantId: 't1', branchId: 'b-main', role: 'GENERAL_EMPLOYEE' } as any, 's-kitchen');
    expect(subRecipes.stationPrep).toHaveBeenCalledWith('t1', 's-kitchen', 'b-main');
  });

  it('a kitchen tablet reads its own station, for the branch of whoever paired it', async () => {
    const { ctl, subRecipes } = build();
    await ctl.prep(device({}) as any, 's-kitchen');
    expect(subRecipes.stationPrep).toHaveBeenCalledWith('t1', 's-kitchen', 'b-B');
  });

  it('refuses a tablet paired to another station, and any screen that is not a kitchen or bar display', async () => {
    const { ctl, subRecipes } = build();
    await expect(ctl.prep(device({}) as any, 's-bar')).rejects.toThrow('This screen is paired to another station.');
    await expect(ctl.prep(device({ deviceRole: 'CUSTOMER_DISPLAY', stationId: null }) as any, 's-kitchen')).rejects.toThrow('Only a kitchen or bar display can show prep levels.');
    expect(subRecipes.stationPrep).not.toHaveBeenCalled();
  });
});
