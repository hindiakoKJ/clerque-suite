import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PriceListsController } from './price-lists.controller';

// Who may read the price lists: the till, plus the Ledger roles that assign a
// list to a customer on the AR Customers screen. Before this, an accountant's
// GET /price-lists 403'd silently and the customer form showed "Default
// pricing" for a customer who has a wholesale list. Writes stay with the till.
const READ_ROLES  = ['CASHIER', 'BRANCH_MANAGER', 'BUSINESS_OWNER', 'ACCOUNTANT', 'AR_ACCOUNTANT', 'BOOKKEEPER', 'FINANCE_LEAD'];
const WRITE_ROLES = ['BRANCH_MANAGER', 'BUSINESS_OWNER'];

describe('PriceListsController roles', () => {
  const guard = new RolesGuard(new Reflector());
  const proto = PriceListsController.prototype;
  const ctx = (handler: (...args: any[]) => unknown, role: string) =>
    ({
      getHandler:   () => handler,
      getClass:     () => PriceListsController,
      switchToHttp: () => ({ getRequest: () => ({ user: { sub: 'u1', tenantId: 't1', role } }) }),
    }) as any;

  it('lets the till and the ledger roles read the lists', () => {
    expect(Reflect.getMetadata(ROLES_KEY, proto.list)).toEqual(READ_ROLES);
    expect(Reflect.getMetadata(ROLES_KEY, proto.getOne)).toEqual(READ_ROLES);
  });

  it.each(['ACCOUNTANT', 'AR_ACCOUNTANT', 'BOOKKEEPER', 'FINANCE_LEAD'])(
    '%s passes the guard on GET /price-lists and GET /price-lists/:id',
    (role) => {
      expect(guard.canActivate(ctx(proto.list, role))).toBe(true);
      expect(guard.canActivate(ctx(proto.getOne, role))).toBe(true);
    },
  );

  it('keeps writes with the till: an accountant may not create, rename or reprice a list', () => {
    for (const handler of [proto.create, proto.update, proto.setItems]) {
      expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual(WRITE_ROLES);
      expect(() => guard.canActivate(ctx(handler, 'ACCOUNTANT'))).toThrow(ForbiddenException);
    }
  });

  it('still refuses a role outside the till and the ledger on reads', () => {
    expect(() => guard.canActivate(ctx(proto.list, 'WAREHOUSE_STAFF'))).toThrow(ForbiddenException);
    expect(() => guard.canActivate(ctx(proto.getOne, 'GENERAL_EMPLOYEE'))).toThrow(ForbiddenException);
  });

  it("list() hands the caller's tenant to the service", async () => {
    const svc = { list: jest.fn(async () => [{ id: 'pl1', name: 'Wholesale' }]) } as any;
    const controller = new PriceListsController(svc);
    await expect(
      controller.list({ sub: 'u1', tenantId: 't1', role: 'ACCOUNTANT' } as any),
    ).resolves.toEqual([{ id: 'pl1', name: 'Wholesale' }]);
    expect(svc.list).toHaveBeenCalledWith('t1');
  });
});
