import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from '../auth/guards/roles.guard';
import { API_KEY_MIN_LEVEL, API_KEY_SCOPE } from '../auth/guards/api-key.guard';
import { ServiceApiController } from './service-api.controller';
import { ReceivingDraftsController } from './receiving-drafts.controller';
import { WarehouseController } from '../warehouse/warehouse.controller';
import { JournalController } from '../accounting/journal.controller';
import { PurchaseOrdersController } from '../purchase-orders/purchase-orders.controller';

/**
 * The routes themselves: every service route names its scope, and every
 * route that posts, approves, voids, confirms or deletes refuses an API key
 * -- checked through the real RolesGuard and the real decorator metadata,
 * so a decorator dropped later fails here.
 */

const service = { role: 'SERVICE', isSuperAdmin: false, isApiKey: true } as any;

function guardSays(ctrl: any, method: string): boolean | 'refused' {
  const guard = new RolesGuard(new Reflector());
  const ctx = {
    switchToHttp: () => ({ getRequest: () => ({ user: service }) }),
    getHandler:   () => ctrl.prototype[method],
    getClass:     () => ctrl,
  } as any;
  try {
    return guard.canActivate(ctx);
  } catch (e) {
    if (e instanceof ForbiddenException) return 'refused';
    throw e;
  }
}

const meta = (key: string, ctrl: any, method: string) =>
  new Reflector().getAllAndOverride(key, [ctrl.prototype[method], ctrl]);

describe('Service API routes', () => {
  const routes: Array<[string, string, string]> = [
    ['snapshot',             'inventory:read',  'read'],
    ['balances',             'ledger:read',     'read'],
    ['draftCount',           'inventory:draft', 'readwrite'],
    ['draftPurchaseRequest', 'inventory:draft', 'readwrite'],
    ['draftReceiving',       'inventory:draft', 'readwrite'],
    ['draftJournal',         'journal:draft',   'readwrite'],
  ];

  it.each(routes)('%s requires scope %s and access %s, and admits the SERVICE role', (method, scope, level) => {
    expect(meta(API_KEY_SCOPE, ServiceApiController, method)).toBe(scope);
    expect(meta(API_KEY_MIN_LEVEL, ServiceApiController, method)).toBe(level);
    expect(guardSays(ServiceApiController, method)).toBe(true);
  });

  it('has no route beyond the reads and the drafts', () => {
    const handlers = Object.getOwnPropertyNames(ServiceApiController.prototype)
      .filter((n) => n !== 'constructor' && n !== 'caller');
    expect(handlers.sort()).toEqual(routes.map((r) => r[0]).sort());
  });

  it('refuses a person signed in with a JWT (the tenant always comes from a key)', () => {
    const ctrl = new ServiceApiController({} as any, {} as any, {} as any);
    expect(() => ctrl.snapshot({ role: 'BUSINESS_OWNER', tenantId: 't1' } as any, {})).toThrow(ForbiddenException);
  });

  it("refuses when the tenant's module is switched off", () => {
    const ctrl = new ServiceApiController({} as any, { balances: jest.fn() } as any, {} as any);
    const key = { isApiKey: true, tenantId: 't1', apiKeyId: 'k1', apiKeyLabel: 'x', moduleLedger: false } as any;
    expect(() => ctrl.balances(key, {})).toThrow(/LEDGER module is switched off/);
  });

  it('takes the tenant from the key, never from the query', async () => {
    const snapshot = jest.fn().mockResolvedValue({});
    const ctrl = new ServiceApiController({ snapshot } as any, {} as any, {} as any);
    const key = { isApiKey: true, tenantId: 't1', apiKeyId: 'k1', apiKeyLabel: 'x', modulePos: true } as any;
    await ctrl.snapshot(key, { tenantId: 't2', branchId: 'b1' });
    expect(snapshot.mock.calls[0][0]).toBe('t1');
  });
});

describe('A machine can never post, approve, void, confirm or delete', () => {
  it.each([
    [WarehouseController, 'postCycleCount'],
    [WarehouseController, 'setLineCount'],
    [JournalController, 'post'],
    [JournalController, 'approve'],
    [JournalController, 'reverse'],
    [ReceivingDraftsController, 'confirm'],
    [ReceivingDraftsController, 'cancel'],
    [PurchaseOrdersController, 'receive'],
  ])('%p.%s refuses an API key', (ctrl, method) => {
    expect(typeof (ctrl as any).prototype[method]).toBe('function');
    expect(guardSays(ctrl, method)).toBe('refused');
  });
});
