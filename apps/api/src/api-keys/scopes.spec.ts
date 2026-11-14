import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import * as bcrypt from 'bcryptjs';
import { ApiKeyGuard, API_KEY_MIN_LEVEL, API_KEY_SCOPE } from '../auth/guards/api-key.guard';
import { JwtOrApiKeyGuard } from '../auth/guards/jwt-or-api-key.guard';
import { ApiKeyStrategy } from '../auth/strategies/api-key.strategy';
import { ApiKeysService } from './api-keys.service';
import { accessLevelForScopes, assertApiKeyScope, effectiveScopes, normaliseScopes } from './scopes';

/**
 * Named scopes confine a machine key to exactly what the owner gave it, and
 * keys of the original kind (no scopes) keep working exactly as they did,
 * without reaching anything new.
 */

const ctxFor = (headers: Record<string, string> = { 'x-api-key': 'clq_live_xxx' }) => {
  const req: any = { headers };
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
const strategyGiving = (p: Record<string, unknown>) =>
  ({ authenticate: jest.fn().mockResolvedValue({ isApiKey: true, role: 'SERVICE', accessLevel: 'read', scopes: [], ...p }) } as unknown as ApiKeyStrategy);

describe('ApiKeyGuard — scopes', () => {
  it('refuses a key without the scope the route names', async () => {
    const guard = new ApiKeyGuard(strategyGiving({ scopes: ['inventory:read'] }), reflectorWith({ [API_KEY_SCOPE]: 'ledger:read' }));
    await expect(guard.canActivate(ctxFor().ctx)).rejects.toMatchObject({ response: { code: 'API_KEY_MISSING_SCOPE', required: 'ledger:read' } });
  });

  it('admits a key holding the scope', async () => {
    const guard = new ApiKeyGuard(strategyGiving({ scopes: ['ledger:read'] }), reflectorWith({ [API_KEY_SCOPE]: 'ledger:read' }));
    await expect(guard.canActivate(ctxFor().ctx)).resolves.toBe(true);
  });

  it('refuses a key of the original kind (no scopes) on a scoped route, however wide its access level', async () => {
    const guard = new ApiKeyGuard(strategyGiving({ scopes: [], accessLevel: 'readwrite' }), reflectorWith({ [API_KEY_SCOPE]: 'inventory:read' }));
    await expect(guard.canActivate(ctxFor().ctx)).rejects.toThrow(ForbiddenException);
  });

  it('refuses a scoped key on a route that names no scope', async () => {
    const guard = new ApiKeyGuard(strategyGiving({ scopes: ['inventory:read'] }), reflectorWith({ [API_KEY_MIN_LEVEL]: 'read' }));
    await expect(guard.canActivate(ctxFor().ctx)).rejects.toMatchObject({ response: { code: 'API_KEY_SCOPED' } });
  });

  it('still admits a key of the original kind on an unscoped route', async () => {
    const guard = new ApiKeyGuard(strategyGiving({ scopes: [] }), reflectorWith({ [API_KEY_MIN_LEVEL]: 'read' }));
    await expect(guard.canActivate(ctxFor().ctx)).resolves.toBe(true);
  });

  it('still enforces the access level before the scope: a draft scope on a read key is not enough', async () => {
    const guard = new ApiKeyGuard(
      strategyGiving({ scopes: ['inventory:draft'], accessLevel: 'read' }),
      reflectorWith({ [API_KEY_MIN_LEVEL]: 'readwrite', [API_KEY_SCOPE]: 'inventory:draft' }),
    );
    await expect(guard.canActivate(ctxFor().ctx)).rejects.toMatchObject({ response: { code: 'API_KEY_INSUFFICIENT_SCOPE' } });
  });
});

describe('JwtOrApiKeyGuard — a scoped key never reaches the shared commerce routes', () => {
  it('refuses a scoped key on the orders/ingest routes (they name no scope)', async () => {
    const guard = new JwtOrApiKeyGuard(
      { canActivate: jest.fn() } as any,
      strategyGiving({ scopes: ['inventory:read'], accessLevel: 'readwrite' }),
      reflectorWith({ [API_KEY_MIN_LEVEL]: 'readwrite' }),
    );
    await expect(guard.canActivate(ctxFor().ctx)).rejects.toMatchObject({ response: { code: 'API_KEY_SCOPED' } });
  });

  it('lets a key of the original kind through as before', async () => {
    const guard = new JwtOrApiKeyGuard(
      { canActivate: jest.fn() } as any,
      strategyGiving({ scopes: [], accessLevel: 'readwrite' }),
      reflectorWith({ [API_KEY_MIN_LEVEL]: 'readwrite' }),
    );
    await expect(guard.canActivate(ctxFor().ctx)).resolves.toBe(true);
  });
});

describe('scope helpers', () => {
  it('normalises: known scopes once each in canonical order, unknown ones named', () => {
    expect(normaliseScopes(['ledger:read', 'inventory:read', 'ledger:read', 'admin:all'])).toEqual({
      scopes: ['inventory:read', 'ledger:read'], unknown: ['admin:all'],
    });
  });

  it('a key that may draft is readwrite; a read-only one is read', () => {
    expect(accessLevelForScopes(['inventory:read'])).toBe('read');
    expect(accessLevelForScopes(['inventory:read', 'journal:draft'])).toBe('readwrite');
  });

  it('a read-only plan drops draft scopes; unknown stored scopes are dropped', () => {
    expect(effectiveScopes(['inventory:read', 'inventory:draft', 'bogus'], 'read')).toEqual(['inventory:read']);
    expect(effectiveScopes(['inventory:read', 'inventory:draft'], 'readwrite')).toEqual(['inventory:read', 'inventory:draft']);
  });

  it('assertApiKeyScope passes only the matching scope', () => {
    expect(() => assertApiKeyScope({ scopes: ['journal:draft'] }, 'journal:draft')).not.toThrow();
    expect(() => assertApiKeyScope({ scopes: ['journal:draft'] }, 'ledger:read')).toThrow(ForbiddenException);
  });
});

describe('ApiKeysService — issuing and resolving scoped keys', () => {
  const prismaWith = (extra: Record<string, unknown> = {}) => ({
    apiKey: {
      create: jest.fn(({ data }: any) => Promise.resolve({ id: 'k1', createdAt: new Date(), ...data })),
      update: jest.fn().mockResolvedValue({}),
      ...extra,
    },
  });

  it('stores the scopes and derives the access level from them', async () => {
    const prisma = prismaWith();
    const svc = new ApiKeysService(prisma as any);
    const issued = await svc.create('t1', 'owner', 'Bookkeeping app', undefined, null, ['journal:draft', 'ledger:read']);
    expect(issued.key).toMatch(/^clq_live_/);
    expect(prisma.apiKey.create.mock.calls[0][0].data).toMatchObject({ scopes: ['ledger:read', 'journal:draft'], accessLevel: 'readwrite' });
  });

  it('refuses an unknown scope rather than dropping it', async () => {
    const svc = new ApiKeysService(prismaWith() as any);
    await expect(svc.create('t1', 'owner', 'x', undefined, null, ['ledger:write'])).rejects.toThrow(BadRequestException);
  });

  it('refuses an access level that contradicts the scopes', async () => {
    const svc = new ApiKeysService(prismaWith() as any);
    await expect(svc.create('t1', 'owner', 'x', 'readwrite', null, ['inventory:read'])).rejects.toThrow(/access "read"/);
  });

  it('a key of the original kind is created exactly as before (no scopes)', async () => {
    const prisma = prismaWith();
    await new ApiKeysService(prisma as any).create('t1', 'owner', 'x', 'read', null);
    expect(prisma.apiKey.create.mock.calls[0][0].data).toMatchObject({ scopes: [], accessLevel: 'read' });
  });

  it('resolving returns the label and scopes for the principal', async () => {
    const key = 'clq_live_' + 'a'.repeat(32); // a made-up key for the test
    const keyHash = await bcrypt.hash(key, 4);
    const prisma = prismaWith({
      findMany: jest.fn().mockResolvedValue([{
        id: 'k1', tenantId: 't1', keyHash, label: 'Bookkeeping app', accessLevel: 'read', scopes: ['inventory:read'],
        tenant: { planCode: 'CLERQUE', taxStatus: 'VAT', businessName: 'A shop', modulePos: true, moduleLedger: true, modulePayroll: true, branches: [] },
      }]),
    });
    const resolved = await new ApiKeysService(prisma as any).resolveKey(key);
    expect(resolved).toMatchObject({ keyId: 'k1', label: 'Bookkeeping app', scopes: ['inventory:read'] });
  });

  it('a scoped key whose stored scopes are all unusable resolves to nothing, never to a key of the original kind', async () => {
    const key = 'clq_live_' + 'b'.repeat(32); // a made-up key for the test
    const keyHash = await bcrypt.hash(key, 4);
    const prisma = prismaWith({
      findMany: jest.fn().mockResolvedValue([{
        id: 'k2', tenantId: 't1', keyHash, label: 'Old', accessLevel: 'readwrite', scopes: ['retired:scope'],
        tenant: { planCode: 'CLERQUE', taxStatus: 'VAT', businessName: null, modulePos: true, moduleLedger: true, modulePayroll: true, branches: [] },
      }]),
    });
    await expect(new ApiKeysService(prisma as any).resolveKey(key)).resolves.toBeNull();
  });
});
