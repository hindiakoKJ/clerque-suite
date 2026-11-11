import { ForbiddenException } from '@nestjs/common';
import type { ApiAccessLevel } from '@repo/shared-types';

/**
 * Named scopes a tenant owner can give an API key, for the service routes
 * under `/service` (apps/api/src/service-api). A scope names exactly what a
 * machine may read or draft; nothing here lets a key post, approve, void or
 * delete, and no scope ever will.
 *
 * Two kinds of key live side by side:
 *
 *   - A key with NO scopes is the original kind: tenant-wide, judged by its
 *     accessLevel on the routes that name 'SERVICE' (orders, ingest). It can
 *     not reach a route that asks for a scope.
 *   - A key WITH scopes is confined to them. It can not reach a route that
 *     asks for no scope, whatever its accessLevel says, so giving a key
 *     `ledger:read` never also hands it the order history.
 */
export const API_KEY_SCOPES = [
  'inventory:read',
  'inventory:draft',
  'ledger:read',
  'journal:draft',
] as const;

export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

/** Scopes that create something (a draft). A read-only plan does not grant them. */
export const DRAFT_SCOPES: ReadonlySet<ApiKeyScope> = new Set<ApiKeyScope>(['inventory:draft', 'journal:draft']);

export function isApiKeyScope(s: unknown): s is ApiKeyScope {
  return typeof s === 'string' && (API_KEY_SCOPES as readonly string[]).includes(s);
}

/**
 * Validate and normalise what an owner asked for: known scopes only, each
 * once, in the canonical order. Returns the unknown names so the caller can
 * refuse them instead of silently dropping a typo.
 */
export function normaliseScopes(input: unknown): { scopes: ApiKeyScope[]; unknown: string[] } {
  if (input == null) return { scopes: [], unknown: [] };
  const list = Array.isArray(input) ? input : [input];
  const unknown = list.filter((s) => !isApiKeyScope(s)).map((s) => String(s));
  const wanted = new Set(list.filter(isApiKeyScope));
  return { scopes: API_KEY_SCOPES.filter((s) => wanted.has(s)), unknown };
}

/** The access level a scoped key is stored with: readwrite only when it may draft. */
export function accessLevelForScopes(scopes: readonly ApiKeyScope[]): ApiAccessLevel {
  return scopes.some((s) => DRAFT_SCOPES.has(s)) ? 'readwrite' : 'read';
}

/**
 * What a stored key may do today. Draft scopes are dropped when the tenant's
 * plan grants only read access -- the same clamp the accessLevel gets in
 * ApiKeysService.resolveKey, so a downgrade narrows a key without a revoke.
 * Anything not a known scope (a row written by hand) is dropped too.
 */
export function effectiveScopes(stored: readonly string[] | null | undefined, planApi: ApiAccessLevel): ApiKeyScope[] {
  const known = (stored ?? []).filter(isApiKeyScope);
  return planApi === 'readwrite' ? known : known.filter((s) => !DRAFT_SCOPES.has(s));
}

/**
 * The scope rule, shared by ApiKeyGuard and JwtOrApiKeyGuard so the two can
 * never disagree:
 *   - a route that requires a scope admits only a key holding it;
 *   - a route that requires none refuses a scoped key.
 */
export function assertApiKeyScope(
  principal: { scopes?: readonly string[] },
  required: ApiKeyScope | undefined,
): void {
  const have = principal.scopes ?? [];
  if (required) {
    if (!have.includes(required)) {
      throw new ForbiddenException({
        code:     'API_KEY_MISSING_SCOPE',
        required,
        have,
        message:  `This endpoint requires the API key scope "${required}".`,
      });
    }
    return;
  }
  if (have.length > 0) {
    throw new ForbiddenException({
      code:    'API_KEY_SCOPED',
      have,
      message: 'This API key is limited to its scopes and cannot use this endpoint.',
    });
  }
}
