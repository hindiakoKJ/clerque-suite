import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './guards/roles.guard';
import { ApiKeyStrategy } from './strategies/api-key.strategy';
import { JwtOrApiKeyGuard } from './guards/jwt-or-api-key.guard';
import { ROLES_KEY } from './decorators/roles.decorator';
import { API_KEY_MIN_LEVEL } from './guards/api-key.guard';
import type { ResolvedApiKey } from '../api-keys/api-keys.service';

/**
 * An API key authenticates a MACHINE, and a machine must never inherit the
 * access a person gets by simply being logged in. These tests pin the two
 * halves of that: the principal we build is narrow, and the authorization
 * layer refuses it everywhere it is not explicitly welcome.
 */

const ctxFor = (user: unknown, headers: Record<string, string> = {}) => {
  const req: any = { user, headers };
  return {
    req,
    ctx: {
      switchToHttp: () => ({ getRequest: () => req }),
      getHandler:   () => 'handler',
      getClass:     () => 'class',
    } as any,
  };
};

const reflectorWith = (values: Record<string, unknown>) =>
  ({ getAllAndOverride: (key: string) => values[key] } as unknown as Reflector);

/* ── The principal ────────────────────────────────────────────────────── */

describe('ApiKeyStrategy — service principal', () => {
  const resolved: ResolvedApiKey = {
    tenantId:        'tenant-1',
    keyId:           'key-abc12345',
    accessLevel:     'readwrite',
    planCode:        'CLERQUE',
    taxStatus:       'VAT',
    businessName:    'Reyes Bakery',
    modulePos:       true,
    moduleLedger:    true,
    modulePayroll:   true,
    defaultBranchId: 'branch-1',
  };

  const strategyFor = (r: ResolvedApiKey | null) =>
    new ApiKeyStrategy({ resolveKey: jest.fn().mockResolvedValue(r) } as any);

  const authenticate = (r: ResolvedApiKey | null = resolved) =>
    strategyFor(r).authenticate({ headers: { 'x-api-key': 'clq_live_xxx' } } as any);

  it('is never a super admin — every guard treats that as a total bypass', async () => {
    expect((await authenticate()).isSuperAdmin).toBe(false);
  });

  it("uses the 'SERVICE' role, which no permission in the matrix grants", async () => {
    expect((await authenticate()).role).toBe('SERVICE');
  });

  it('carries no user id, so nothing can be attributed to a person who did not act', async () => {
    const p = await authenticate();
    expect(p.sub).toBe('');
  });

  it('gets POS at OPERATOR — enough to sell, not enough to reconfigure', async () => {
    const p = await authenticate();
    expect(p.appAccess).toContainEqual({ app: 'POS', level: 'OPERATOR' });
  });

  it('never gets Ledger or Payroll access, even when the tenant has both modules', async () => {
    const p = await authenticate();
    expect(p.appAccess).toContainEqual({ app: 'LEDGER',  level: 'NONE' });
    expect(p.appAccess).toContainEqual({ app: 'PAYROLL', level: 'NONE' });
  });

  it('loses POS access when the tenant does not have the POS module', async () => {
    const p = await authenticate({ ...resolved, modulePos: false });
    expect(p.appAccess).toContainEqual({ app: 'POS', level: 'NONE' });
  });

  it('takes tax status from the tenant record, not from the caller', async () => {
    const p = await authenticate();
    expect(p.taxStatus).toBe('VAT');
    expect(p.isVatRegistered).toBe(true);
  });

  it('holds no custom permissions or persona that could widen it per tenant', async () => {
    const p = await authenticate();
    expect(p.customPermissions).toEqual([]);
    expect(p.personaKey).toBeNull();
  });

  it('rejects an unresolvable key', async () => {
    await expect(authenticate(null)).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a request with no key at all', async () => {
    await expect(
      strategyFor(resolved).authenticate({ headers: {} } as any),
    ).rejects.toThrow(UnauthorizedException);
  });
});

/* ── Authorization ────────────────────────────────────────────────────── */

describe('RolesGuard — machine principals fail closed', () => {
  const service = { role: 'SERVICE', isSuperAdmin: false } as any;
  const cashier = { role: 'CASHIER', isSuperAdmin: false } as any;

  it("refuses a service principal on a route that doesn't name SERVICE", () => {
    const guard = new RolesGuard(reflectorWith({ [ROLES_KEY]: ['CASHIER', 'BUSINESS_OWNER'] }));
    expect(() => guard.canActivate(ctxFor(service).ctx)).toThrow(ForbiddenException);
  });

  it('refuses a service principal on a route with NO @Roles at all', () => {
    // The important case. "No @Roles" means "any authenticated human"; if it
    // also meant "any API key", every route added later would silently widen
    // what every ecosystem app can reach.
    const guard = new RolesGuard(reflectorWith({ [ROLES_KEY]: undefined }));
    expect(() => guard.canActivate(ctxFor(service).ctx)).toThrow(ForbiddenException);
  });

  it('allows a service principal only where SERVICE is named explicitly', () => {
    const guard = new RolesGuard(reflectorWith({ [ROLES_KEY]: ['CASHIER', 'SERVICE'] }));
    expect(guard.canActivate(ctxFor(service).ctx)).toBe(true);
  });

  it('still lets a human through an unrestricted route', () => {
    const guard = new RolesGuard(reflectorWith({ [ROLES_KEY]: undefined }));
    expect(guard.canActivate(ctxFor(cashier).ctx)).toBe(true);
  });
});

describe('JwtOrApiKeyGuard', () => {
  const principal = {
    isApiKey: true, apiKeyId: 'key-1', accessLevel: 'read', role: 'SERVICE',
  } as any;

  const build = (opts: { jwtOk: boolean; minLevel?: string; level?: string }) =>
    new JwtOrApiKeyGuard(
      { canActivate: jest.fn().mockImplementation((ctx: any) => {
          if (!opts.jwtOk) throw new UnauthorizedException();
          ctx.switchToHttp().getRequest().user = { role: 'CASHIER' };
          return true;
        }) } as any,
      { authenticate: jest.fn().mockResolvedValue({
          ...principal, accessLevel: opts.level ?? 'readwrite',
        }) } as any,
      reflectorWith({ [API_KEY_MIN_LEVEL]: opts.minLevel }),
    );

  it('prefers the JWT when the caller is a signed-in person', async () => {
    const guard = build({ jwtOk: true });
    const { ctx, req } = ctxFor(undefined);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req.user.role).toBe('CASHIER');
  });

  it('falls back to the API key when there is no usable JWT', async () => {
    const guard = build({ jwtOk: false });
    const { ctx, req } = ctxFor(undefined);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req.user.role).toBe('SERVICE');
  });

  it("doesn't waste a JWT attempt on an obvious API key", async () => {
    const jwt = { canActivate: jest.fn() };
    const guard = new JwtOrApiKeyGuard(
      jwt as any,
      { authenticate: jest.fn().mockResolvedValue(principal) } as any,
      reflectorWith({}),
    );
    const { ctx } = ctxFor(undefined, { 'x-api-key': 'clq_live_xxx' });
    await guard.canActivate(ctx);
    expect(jwt.canActivate).not.toHaveBeenCalled();
  });

  it('rejects a read-only key on a route that requires readwrite', async () => {
    const guard = build({ jwtOk: false, minLevel: 'readwrite', level: 'read' });
    const { ctx } = ctxFor(undefined);
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      response: { code: 'API_KEY_INSUFFICIENT_SCOPE' },
    });
  });

  it('accepts a readwrite key on a route that requires readwrite', async () => {
    const guard = build({ jwtOk: false, minLevel: 'readwrite', level: 'readwrite' });
    const { ctx } = ctxFor(undefined);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });
});
