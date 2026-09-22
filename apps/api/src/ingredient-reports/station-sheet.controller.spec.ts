import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtOrDeviceTokenAuthGuard } from '../auth/guards/jwt-or-device-token.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { STATION_ROLES } from '../kds/station-access';
import { DailySheetController, StationSheetController } from './station-sheet.controller';
import { buildSheet, stationSheet } from './stock-sheet';

// The sheet itself has its own spec; here only who may read which sheet, the day asked for, and what the owner's copy adds.
const SHEET_ROWS = () => [{
  key: 'INGREDIENTS', title: 'Ingredients',
  rows: [
    { rawMaterialId: 'milk', name: 'Fresh Milk', unit: 'ml', packSize: 1000, alsoOn: [], cells: { ending: '3 pk + 400 ml' } },
    { rawMaterialId: 'eggs', name: 'Eggs', unit: 'pc', packSize: null, alsoOn: [], cells: { ending: '24 pc' } },
  ],
}];
const WINDOW = { from: '2026-09-20T15:00:00.000Z', to: '2026-09-21T15:00:00.000Z', fromLabel: '', toLabel: '' };
jest.mock('./stock-sheet', () => ({
  sheetAmount: jest.requireActual('./stock-sheet').sheetAmount,
  stationSheet: jest.fn(async () => ({ title: 'KITCHEN INVENTORY', window: WINDOW, sections: SHEET_ROWS() })),
  buildSheet: jest.fn(async () => ({ title: 'DAILY INVENTORY', window: WINDOW, sections: SHEET_ROWS() })),
}));

describe('the daily inventory sheet routes', () => {
  const stations = [
    { id: 's-kitchen', tenantId: 't1', name: 'Kitchen', kind: 'KITCHEN', branchId: null },
    { id: 's-bar', tenantId: 't1', name: 'Bar', kind: 'BAR', branchId: null },
  ];
  const users = [
    { id: 'owner', tenantId: 't1', name: 'Carol', branchId: 'b-main', isActive: true },
    { id: 'left', tenantId: 't1', name: 'Former Manager', branchId: 'b-main', isActive: false },
  ];
  const branches = [{ id: 'b-main', tenantId: 't1', name: 'Main' }, { id: 'b-naga', tenantId: 't1', name: 'Naga' }];
  /** Weekly counts sent from the screens: none unless a test adds one. */
  const weeklyCounts: any[] = [];
  const prisma: any = {
    cycleCount: { findMany: jest.fn(async () => weeklyCounts) },
    station: {
      findFirst: jest.fn(async ({ where }: any) => stations.find((s) => s.id === where.id && s.tenantId === where.tenantId) ?? null),
      findMany: jest.fn(async () => stations.map(({ id, name, kind }) => ({ id, name, kind }))),
    },
    user: { findFirst: jest.fn(async ({ where }: any) => users.find((u) => u.id === where.id && u.tenantId === where.tenantId) ?? null) },
    branch: {
      findFirst: jest.fn(async ({ where }: any) => {
        const b = where.id ? branches.find((x) => x.id === where.id && x.tenantId === where.tenantId) : branches.find((x) => x.tenantId === where.tenantId);
        return b ? { id: b.id, name: b.name } : null;
      }),
      findMany: jest.fn(async () => branches.map(({ id, name }) => ({ id, name }))),
    },
  };
  beforeEach(() => {
    jest.clearAllMocks();
    weeklyCounts.length = 0;
  });
  /** A weekly count the kitchen sent within the sheet's hours: milk 337 ml short of the book at that moment. */
  const sentCount = () => ({
    createdAt: new Date('2026-09-21T13:00:00Z'),
    lines: [{ rawMaterialId: 'milk', countedQty: 2800, expectedQty: 3137, notes: '[BY:Joy] [AT:2026-09-21T13:05:00.000Z] [ST:s-kitchen]' }],
  });
  /** Every key anywhere in a response, however deep. */
  const keysOf = (v: unknown): string[] => {
    if (Array.isArray(v)) return v.flatMap(keysOf);
    if (v && typeof v === 'object') return Object.entries(v as Record<string, unknown>).flatMap(([k, x]) => [k, ...keysOf(x)]);
    return [];
  };

  describe('GET /kds/stations/:id/daily-inventory', () => {
    const controller = new StationSheetController(prisma);
    const device = (over: Record<string, unknown> = {}) =>
      ({ sub: 'owner', tenantId: 't1', isDevice: true, deviceRole: 'KDS_KITCHEN', stationId: 's-kitchen', role: 'KIOSK_DISPLAY', ...over }) as any;

    it('is guarded for a paired screen or a login, with the station roles', () => {
      expect(Reflect.getMetadata(GUARDS_METADATA, StationSheetController)).toEqual([JwtOrDeviceTokenAuthGuard, RolesGuard]);
      expect(Reflect.getMetadata(ROLES_KEY, StationSheetController.prototype.dailyInventory)).toEqual([...STATION_ROLES]);
    });

    it('a kitchen screen reads its own station\'s sheet, for the branch of whoever paired it', async () => {
      await expect(controller.dailyInventory(device(), 's-kitchen')).resolves.toMatchObject({ title: 'KITCHEN INVENTORY' });
      expect(stationSheet).toHaveBeenCalledWith(prisma, expect.objectContaining({
        tenantId: 't1', station: { id: 's-kitchen', name: 'Kitchen', kind: 'KITCHEN' }, branch: { id: 'b-main', name: 'Main' }, isDevice: true,
      }), null, expect.any(Date));
    });

    it('refuses a screen paired to another station, one paired to none, and the customer display', async () => {
      await expect(controller.dailyInventory(device(), 's-bar')).rejects.toThrow(new ForbiddenException('This screen is paired to another station.'));
      await expect(controller.dailyInventory(device({ stationId: null }), 's-kitchen')).rejects.toThrow(ForbiddenException);
      await expect(controller.dailyInventory(device({ deviceRole: 'CUSTOMER_DISPLAY' }), 's-kitchen')).rejects.toThrow(ForbiddenException);
      expect(stationSheet).not.toHaveBeenCalled();
    });

    it('still reads for a screen whose pairer has left: reading changes nothing', async () => {
      await expect(controller.dailyInventory(device({ sub: 'left' }), 's-kitchen')).resolves.toBeDefined();
    });

    it('a logged-in person reads any station of their shop, and not another shop\'s', async () => {
      await controller.dailyInventory({ sub: 'owner', tenantId: 't1', branchId: 'b-naga', role: 'BUSINESS_OWNER' } as any, 's-bar');
      expect(stationSheet).toHaveBeenCalledWith(prisma, expect.objectContaining({ branch: { id: 'b-naga', name: 'Naga' }, actorLabel: 'Carol' }), null, expect.any(Date));
      await expect(controller.dailyInventory({ sub: 'owner', tenantId: 't2', branchId: null, role: 'BUSINESS_OWNER' } as any, 's-kitchen'))
        .rejects.toThrow(NotFoundException);
    });

    it('passes a real day through, refuses one that is not, and an empty one means the default sheet', async () => {
      await controller.dailyInventory(device(), 's-kitchen', '2026-09-16');
      expect((stationSheet as jest.Mock).mock.calls[0][2]).toBe('2026-09-16');
      await controller.dailyInventory(device(), 's-kitchen', '');
      expect((stationSheet as jest.Mock).mock.calls[1][2]).toBeNull();
      await expect(controller.dailyInventory(device(), 's-kitchen', '2026-13-01')).rejects.toThrow(new BadRequestException('The day has to be a real date (YYYY-MM-DD).'));
      // A refused screen learns nothing about its day.
      await expect(controller.dailyInventory(device(), 's-bar', 'nonsense')).rejects.toThrow(ForbiddenException);
    });
  });

  describe('GET /reports/ingredients/daily-sheet (the owner\'s copy)', () => {
    const controller = new DailySheetController(prisma);
    const person = (role: string, branchId: string | null) => ({ sub: 'owner', tenantId: 't1', branchId, role, isSuperAdmin: false }) as any;

    it('is for logins only, and only the owner, managers, MDM and super admin', () => {
      expect(Reflect.getMetadata(GUARDS_METADATA, DailySheetController)).toEqual([JwtAuthGuard, RolesGuard]);
      expect(Reflect.getMetadata(ROLES_KEY, DailySheetController.prototype.dailySheet)).toEqual(['BUSINESS_OWNER', 'BRANCH_MANAGER', 'MDM', 'SUPER_ADMIN']);
    });

    it('the owner picks any branch and station, and gets the branches and stations to pick from', async () => {
      const out = await controller.dailySheet(person('BUSINESS_OWNER', 'b-main'), 'b-naga', 's-bar', '2026-09-16');
      expect(buildSheet).toHaveBeenCalledWith(prisma, {
        tenantId: 't1', branch: { id: 'b-naga', name: 'Naga' }, station: { id: 's-bar', name: 'Bar', kind: 'BAR' },
      }, '2026-09-16', expect.any(Date));
      expect(out.choices.branches.map((b) => b.id)).toEqual(['b-main', 'b-naga']);
      expect(out.choices.stations.map((s) => s.id)).toEqual(['s-kitchen', 's-bar']);
    });

    it('offers the shop\'s stations on every branch: they are made once, tied to the first branch', async () => {
      // As layouts.service makes them: both stations carry Main's id, and the owner picks Naga.
      const tiedToMain = [
        { id: 's-kitchen', tenantId: 't1', name: 'Kitchen', kind: 'KITCHEN', branchId: 'b-main', isActive: true },
        { id: 's-bar', tenantId: 't1', name: 'Bar', kind: 'BAR', branchId: 'b-main', isActive: true },
        { id: 's-old', tenantId: 't1', name: 'Old Grill', kind: 'KITCHEN', branchId: 'b-main', isActive: false },
        { id: 's-other', tenantId: 't2', name: 'Kitchen', kind: 'KITCHEN', branchId: 'b-x', isActive: true },
      ];
      // A fake that applies the filter it is given, so a branch filter would show up as a missing station.
      prisma.station.findMany.mockImplementationOnce(async ({ where }: any) => tiedToMain
        .filter((s) => s.tenantId === where.tenantId && s.isActive === where.isActive)
        .filter((s) => !where.OR || where.OR.some((o: any) => s.branchId === o.branchId))
        .map(({ id, name, kind }) => ({ id, name, kind })));
      const out = await controller.dailySheet(person('BUSINESS_OWNER', 'b-main'), 'b-naga');
      expect(out.choices.stations.map((s) => s.id)).toEqual(['s-kitchen', 's-bar']);
      expect(prisma.station.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: 't1', isActive: true } }));
    });

    it('with no station, every item of the branch; with no branch, their own or the first', async () => {
      await controller.dailySheet(person('BUSINESS_OWNER', null));
      expect(buildSheet).toHaveBeenCalledWith(prisma, expect.objectContaining({ branch: { id: 'b-main', name: 'Main' }, station: null }), null, expect.any(Date));
    });

    it('a manager tied to one branch sees only that branch; a manager of every branch may pick', async () => {
      await expect(controller.dailySheet(person('BRANCH_MANAGER', 'b-main'), 'b-naga')).rejects.toThrow(ForbiddenException);
      const own = await controller.dailySheet(person('BRANCH_MANAGER', 'b-main'));
      expect(own.choices.branches).toEqual([{ id: 'b-main', name: 'Main' }]);
      await expect(controller.dailySheet(person('BRANCH_MANAGER', null), 'b-naga')).resolves.toBeDefined();
    });

    it('beside the book, says what a weekly count sent on the sheet hours found, and how far off it was', async () => {
      weeklyCounts.push(sentCount());
      const out: any = await controller.dailySheet(person('BUSINESS_OWNER', 'b-main'));
      expect(out.showCounted).toBe(true);
      const [milk, eggs] = out.sections[0].rows;
      expect(milk).toMatchObject({ counted: 2800, difference: -337, cells: { ending: '3 pk + 400 ml', counted: '2 pk + 800 ml', difference: '337 ml short' } });
      expect(eggs).not.toHaveProperty('counted');
      expect(eggs).not.toHaveProperty('difference');
      expect(prisma.cycleCount.findMany.mock.calls[0][0].where).toMatchObject({
        tenantId: 't1', branchId: 'b-main', status: { in: ['RECORDED', 'POSTED'] }, notes: { startsWith: '[WEEKLY:' },
      });
    });

    it('a difference of a pack or more says short or extra after the whole amount, never a sign in front', async () => {
      // "−1 pk + 337 ml" read as minus 1 pack, plus 337 ml.
      const off = (countedQty: number, expectedQty: number) => ({ ...sentCount(), lines: [{ ...sentCount().lines[0], countedQty, expectedQty }] });
      weeklyCounts.push(off(1800, 3137));
      let out: any = await controller.dailySheet(person('BUSINESS_OWNER', 'b-main'));
      expect(out.sections[0].rows[0].cells).toMatchObject({ counted: '1 pk + 800 ml', difference: '1 pk + 337 ml short' });
      weeklyCounts.splice(0, 1, off(4337, 3137));
      out = await controller.dailySheet(person('BUSINESS_OWNER', 'b-main'));
      expect(out.sections[0].rows[0].cells).toMatchObject({ counted: '4 pk + 337 ml', difference: '1 pk + 200 ml extra' });
    });

    it('with no count on the sheet hours, no columns', async () => {
      const out: any = await controller.dailySheet(person('BUSINESS_OWNER', 'b-main'));
      expect(out.showCounted).toBe(false);
      expect(keysOf(out.sections).filter((k) => k === 'counted' || k === 'difference')).toEqual([]);
    });

    it('the station copy never carries them, even on a day with a count', async () => {
      weeklyCounts.push(sentCount());
      const station = new StationSheetController(prisma);
      const out = await station.dailyInventory({ sub: 'owner', tenantId: 't1', isDevice: true, deviceRole: 'KDS_KITCHEN', stationId: 's-kitchen', role: 'KIOSK_DISPLAY' } as any, 's-kitchen');
      expect(keysOf(out).filter((k) => /counted|difference|showCounted/i.test(k))).toEqual([]);
      expect(prisma.cycleCount.findMany).not.toHaveBeenCalled();
    });

    it('refuses an unknown branch or station and a day that is not a date', async () => {
      await expect(controller.dailySheet(person('BUSINESS_OWNER', null), 'b-nowhere')).rejects.toThrow(NotFoundException);
      await expect(controller.dailySheet(person('BUSINESS_OWNER', null), undefined, 's-nowhere')).rejects.toThrow(NotFoundException);
      await expect(controller.dailySheet(person('BUSINESS_OWNER', null), undefined, undefined, '2026-9-1')).rejects.toThrow(BadRequestException);
    });
  });
});
