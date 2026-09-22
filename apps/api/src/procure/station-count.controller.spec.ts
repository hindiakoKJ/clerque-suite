import 'reflect-metadata';
import { ForbiddenException, RequestMethod } from '@nestjs/common';
import { GUARDS_METADATA, HTTP_CODE_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtOrDeviceTokenAuthGuard } from '../auth/guards/jwt-or-device-token.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { STATION_ROLES, stationContext } from '../kds/station-access';
import { ProcureModule } from './procure.module';
import { StationCountService } from './station-count.service';
import { StationCountController, WEEKLY_REVIEW_ROLES, WeeklyCountReviewController, scopeOf } from './station-count.controller';

// Who may use a station screen has its own spec (station-access.spec.ts); here only that each route asks, and how.
jest.mock('../kds/station-access', () => ({
  ...jest.requireActual('../kds/station-access'),
  stationContext: jest.fn(async () => ({ tenantId: 't1', station: { id: 's-kitchen' } })),
}));

/**
 * The weekly count's routes: the station's three behind the paired-screen
 * guard and the station roles, the owner's four behind a login and the
 * owner, manager and MDM roles; which calls may write; and that a manager
 * tied to one branch is kept to it.
 */
describe('weekly count routes', () => {
  const route = (cls: any, name: string) => {
    const handler = cls.prototype[name];
    return {
      path: Reflect.getMetadata(PATH_METADATA, handler),
      method: Reflect.getMetadata(METHOD_METADATA, handler),
      roles: Reflect.getMetadata(ROLES_KEY, handler),
      code: Reflect.getMetadata(HTTP_CODE_METADATA, handler),
    };
  };

  beforeEach(() => jest.clearAllMocks());

  describe('the station screen', () => {
    const counts: any = { view: jest.fn(async () => ({})), save: jest.fn(async () => ({})), send: jest.fn(async () => ({})) };
    const prisma: any = {};
    const ctl = new StationCountController(prisma, counts);
    const device = { sub: 'pairer', tenantId: 't1', isDevice: true, deviceRole: 'KDS_KITCHEN', stationId: 's-kitchen', role: 'KIOSK_DISPLAY' } as any;

    it('is under /kds for a paired screen or a login, with the station roles', () => {
      expect(Reflect.getMetadata(PATH_METADATA, StationCountController)).toBe('kds');
      expect(Reflect.getMetadata(GUARDS_METADATA, StationCountController)).toEqual([JwtOrDeviceTokenAuthGuard, RolesGuard]);
      expect(route(StationCountController, 'panel')).toEqual({ path: 'stations/:id/count', method: RequestMethod.GET, roles: [...STATION_ROLES], code: undefined });
      expect(route(StationCountController, 'save')).toEqual({ path: 'stations/:id/count/lines', method: RequestMethod.POST, roles: [...STATION_ROLES], code: 200 });
      expect(route(StationCountController, 'send')).toEqual({ path: 'stations/:id/count/send', method: RequestMethod.POST, roles: [...STATION_ROLES], code: 200 });
    });

    it('reading asks for a read; saving and sending ask for a write, so a screen whose pairer has left cannot', async () => {
      await ctl.panel(device, 's-kitchen');
      await ctl.save(device, 's-kitchen', { rawMaterialId: 'milk', qty: 1, by: 'Joy' });
      await ctl.send(device, 's-kitchen', { by: 'Joy' });
      expect((stationContext as jest.Mock).mock.calls.map((c) => [c[2], c[3]])).toEqual([
        ['s-kitchen', { write: false }], ['s-kitchen', { write: true }], ['s-kitchen', { write: true }],
      ]);
      expect(counts.save).toHaveBeenCalledWith({ tenantId: 't1', station: { id: 's-kitchen' } }, { rawMaterialId: 'milk', qty: 1, by: 'Joy' }, expect.any(Date));
      expect(counts.send).toHaveBeenCalledWith(expect.anything(), { by: 'Joy' }, expect.any(Date));
    });

    it('a refused screen reaches nothing', async () => {
      (stationContext as jest.Mock).mockRejectedValueOnce(new ForbiddenException('This screen is paired to another station.'));
      await expect(ctl.save(device, 's-bar', { rawMaterialId: 'milk', qty: 1 })).rejects.toThrow('This screen is paired to another station.');
      expect(counts.save).not.toHaveBeenCalled();
    });
  });

  describe('the owner\'s review', () => {
    const counts: any = {
      list: jest.fn(async () => []), review: jest.fn(async () => ({})), recount: jest.fn(async () => ({})), adjust: jest.fn(async () => ({})),
    };
    const ctl = new WeeklyCountReviewController(counts);
    const person = (role: string, branchId: string | null, isSuperAdmin = false) => ({ sub: 'u1', tenantId: 't1', role, branchId, isSuperAdmin }) as any;

    it('is under /procure/weekly-counts for a login, the owner, managers and MDM only', () => {
      expect(Reflect.getMetadata(PATH_METADATA, WeeklyCountReviewController)).toBe('procure/weekly-counts');
      expect(Reflect.getMetadata(GUARDS_METADATA, WeeklyCountReviewController)).toEqual([JwtAuthGuard, RolesGuard]);
      expect([...WEEKLY_REVIEW_ROLES]).toEqual(['BUSINESS_OWNER', 'BRANCH_MANAGER', 'MDM']);
      const roles = [...WEEKLY_REVIEW_ROLES];
      expect(route(WeeklyCountReviewController, 'list')).toEqual({ path: '/', method: RequestMethod.GET, roles, code: undefined });
      expect(route(WeeklyCountReviewController, 'review')).toEqual({ path: ':id', method: RequestMethod.GET, roles, code: undefined });
      expect(route(WeeklyCountReviewController, 'recount')).toEqual({ path: ':id/recount', method: RequestMethod.POST, roles, code: 200 });
      expect(route(WeeklyCountReviewController, 'adjust')).toEqual({ path: ':id/adjust', method: RequestMethod.POST, roles, code: 200 });
    });

    it('the roles guard refuses a cashier, a cook and a paired screen', () => {
      const guard = new RolesGuard(new Reflector());
      const call = (user: any) => guard.canActivate({
        getHandler: () => WeeklyCountReviewController.prototype.adjust,
        getClass: () => WeeklyCountReviewController,
        switchToHttp: () => ({ getRequest: () => ({ user }) }),
      } as any);
      for (const role of ['CASHIER', 'GENERAL_EMPLOYEE', 'KIOSK_DISPLAY', 'WAREHOUSE_STAFF']) {
        expect(() => call(person(role, 'b1'))).toThrow(ForbiddenException);
      }
      for (const role of WEEKLY_REVIEW_ROLES) expect(call(person(role, 'b1'))).toBe(true);
    });

    it('a manager tied to one branch is kept to it; the owner, MDM and a manager of every branch are not', async () => {
      expect(scopeOf(person('BRANCH_MANAGER', 'b1'))).toEqual({ tenantId: 't1', ownBranchId: 'b1' });
      expect(scopeOf(person('BRANCH_MANAGER', null))).toEqual({ tenantId: 't1', ownBranchId: null });
      expect(scopeOf(person('BUSINESS_OWNER', 'b1'))).toEqual({ tenantId: 't1', ownBranchId: null });
      expect(scopeOf(person('MDM', 'b1'))).toEqual({ tenantId: 't1', ownBranchId: null });
      expect(scopeOf(person('BRANCH_MANAGER', 'b1', true))).toEqual({ tenantId: 't1', ownBranchId: null });

      await ctl.review(person('BRANCH_MANAGER', 'b1'), 'cc1');
      await ctl.recount(person('BRANCH_MANAGER', 'b1'), 'cc1', { rawMaterialIds: ['milk'] });
      await ctl.adjust(person('BRANCH_MANAGER', 'b1'), 'cc1', { isOpeningBalance: false });
      await ctl.list(person('BRANCH_MANAGER', 'b1'), 'b2', 'RECORDED');
      const scope = { tenantId: 't1', ownBranchId: 'b1' };
      expect(counts.review).toHaveBeenCalledWith(scope, 'cc1', expect.any(Date));
      expect(counts.recount).toHaveBeenCalledWith(scope, 'cc1', 'u1', { rawMaterialIds: ['milk'] }, expect.any(Date));
      expect(counts.adjust).toHaveBeenCalledWith(scope, 'cc1', 'u1', { isOpeningBalance: false }, expect.any(Date));
      expect(counts.list).toHaveBeenCalledWith(scope, { branchId: 'b2', status: 'RECORDED' });
    });

    it('the service refuses another branch\'s count for a manager kept to one branch', async () => {
      const prisma: any = {
        cycleCount: { findFirst: jest.fn(async () => ({ id: 'cc1', tenantId: 't1', branchId: 'b2', notes: '[WEEKLY:2026-09-21] [ST:s1]', lines: [] })) },
      };
      const svc = new StationCountService(prisma, {} as any);
      const real = new WeeklyCountReviewController(svc);
      await expect(real.review(person('BRANCH_MANAGER', 'b1'), 'cc1')).rejects.toThrow(new ForbiddenException('You can only see the counts of your own branch.'));
      await expect(real.adjust(person('BRANCH_MANAGER', 'b1'), 'cc1', {})).rejects.toThrow(ForbiddenException);
      await expect(real.recount(person('BRANCH_MANAGER', 'b1'), 'cc1', { rawMaterialIds: ['milk'] })).rejects.toThrow(ForbiddenException);
    });
  });

  it('both are served by the Procure module, with the service', () => {
    expect(Reflect.getMetadata('controllers', ProcureModule)).toEqual(expect.arrayContaining([StationCountController, WeeklyCountReviewController]));
    expect(Reflect.getMetadata('providers', ProcureModule)).toContain(StationCountService);
  });
});
