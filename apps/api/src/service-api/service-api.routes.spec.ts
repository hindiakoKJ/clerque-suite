import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from '../auth/guards/roles.guard';
import { API_KEY_MIN_LEVEL, API_KEY_SCOPE } from '../auth/guards/api-key.guard';
import { ServiceApiController } from './service-api.controller';
import { ReceivingDraftsController } from './receiving-drafts.controller';
import { WarehouseController } from '../warehouse/warehouse.controller';
import { JournalController } from '../accounting/journal.controller';
import { PurchaseOrdersController } from '../purchase-orders/purchase-orders.controller';
import { ProcureReceiptsController } from '../procure/procure-receipts.controller';
import { ReceiptReadLimitGuard, ReleaseReceiptReadInterceptor } from '../procure/receipt-read-limit.guard';

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
    ['readReceipt',          'procure:receipts', 'readwrite'],
    ['postReceipt',          'procure:receipts', 'readwrite'],
  ];

  it.each(routes)('%s requires scope %s and access %s, and admits the SERVICE role', (method, scope, level) => {
    expect(meta(API_KEY_SCOPE, ServiceApiController, method)).toBe(scope);
    expect(meta(API_KEY_MIN_LEVEL, ServiceApiController, method)).toBe(level);
    expect(guardSays(ServiceApiController, method)).toBe(true);
  });

  it('has no route beyond the reads, the drafts and the paid receipts', () => {
    const handlers = Object.getOwnPropertyNames(ServiceApiController.prototype)
      .filter((n) => n !== 'constructor' && n !== 'caller' && n !== 'receiptsCaller');
    expect(handlers.sort()).toEqual(routes.map((r) => r[0]).sort());
  });

  it('only the paid-receipt routes take the scope that posts', () => {
    const posting = routes.filter((r) => r[1] === 'procure:receipts').map((r) => r[0]).sort();
    expect(posting).toEqual(['postReceipt', 'readReceipt']);
  });

  it("a receipt read is held to the shop's daily read cap, like the app's own Read button", () => {
    const guards = Reflect.getMetadata('__guards__', ServiceApiController.prototype.readReceipt) ?? [];
    const interceptors = Reflect.getMetadata('__interceptors__', ServiceApiController.prototype.readReceipt) ?? [];
    expect(guards).toContain(ReceiptReadLimitGuard);
    expect(interceptors).toContain(ReleaseReceiptReadInterceptor);
  });

  it('the receipt routes take the tenant and the default branch from the key', async () => {
    const receipts = { read: jest.fn().mockResolvedValue({}), post: jest.fn().mockResolvedValue({}) };
    const ctrl = new ServiceApiController({} as any, {} as any, {} as any, receipts as any);
    const key = { isApiKey: true, tenantId: 't1', apiKeyId: 'k1', apiKeyLabel: 'AIBA', branchId: 'b1', modulePos: true } as any;
    await ctrl.postReceipt(key, { reference: 'r' } as any);
    expect(receipts.post.mock.calls[0][0]).toEqual({ tenantId: 't1', keyId: 'k1', label: 'AIBA', defaultBranchId: 'b1' });
    // The read answers today's reads after this one, as the app's own Read does.
    const read = await ctrl.readReceipt(key, {} as any, { receiptReads: { usedToday: 3, limit: 50, resetsAt: 'tomorrow' } } as any);
    expect(read).toMatchObject({ reads: { usedToday: 4, limit: 50, resetsAt: 'tomorrow' } });
    expect(receipts.read.mock.calls[0][0]).toMatchObject({ tenantId: 't1', defaultBranchId: 'b1' });
    expect(() => ctrl.readReceipt({ role: 'BUSINESS_OWNER', tenantId: 't1' } as any, {} as any)).toThrow(ForbiddenException);
    expect(() => ctrl.postReceipt({ ...key, modulePos: false }, {} as any)).toThrow(/POS module is switched off/);
  });

  it('refuses a person signed in with a JWT (the tenant always comes from a key)', () => {
    const ctrl = new ServiceApiController({} as any, {} as any, {} as any, {} as any);
    expect(() => ctrl.snapshot({ role: 'BUSINESS_OWNER', tenantId: 't1' } as any, {})).toThrow(ForbiddenException);
  });

  it("refuses when the tenant's module is switched off", () => {
    const ctrl = new ServiceApiController({} as any, { balances: jest.fn() } as any, {} as any, {} as any);
    const key = { isApiKey: true, tenantId: 't1', apiKeyId: 'k1', apiKeyLabel: 'x', moduleLedger: false } as any;
    expect(() => ctrl.balances(key, {})).toThrow(/LEDGER module is switched off/);
  });

  it('takes the tenant from the key, never from the query', async () => {
    const snapshot = jest.fn().mockResolvedValue({});
    const ctrl = new ServiceApiController({ snapshot } as any, {} as any, {} as any, {} as any);
    const key = { isApiKey: true, tenantId: 't1', apiKeyId: 'k1', apiKeyLabel: 'x', modulePos: true } as any;
    await ctrl.snapshot(key, { tenantId: 't2', branchId: 'b1' });
    expect(snapshot.mock.calls[0][0]).toBe('t1');
  });
});

describe('A machine can never post, approve, void, confirm or delete (paid receipts under /service aside)', () => {
  it.each([
    [WarehouseController, 'postCycleCount'],
    [WarehouseController, 'setLineCount'],
    [JournalController, 'post'],
    [JournalController, 'approve'],
    [JournalController, 'reverse'],
    [ReceivingDraftsController, 'confirm'],
    [ReceivingDraftsController, 'cancel'],
    [PurchaseOrdersController, 'receive'],
    // The app's own receipt routes stay people-only; a key reads and posts
    // receipts only through /service, under procure:receipts.
    [ProcureReceiptsController, 'parse'],
    [ProcureReceiptsController, 'confirm'],
  ])('%p.%s refuses an API key', (ctrl, method) => {
    expect(typeof (ctrl as any).prototype[method]).toBe('function');
    expect(guardSays(ctrl, method)).toBe('refused');
  });
});
