import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { ApiKeysService } from '../../api-keys/api-keys.service';
import type { ApiAccessLevel, JwtPayload } from '@repo/shared-types';
import { PLAN_FEATURES, PLAN_LIMITS, taxStatusFlags } from '@repo/shared-types';
import type { ApiKeyScope } from '../../api-keys/scopes';

/**
 * The principal a request gets when it authenticates with an API key
 * instead of a login. It is a real `JwtPayload` plus three machine-only
 * fields, so every existing guard (RolesGuard, AppAccessGuard,
 * PlanFeatureGuard) reads it without modification.
 */
export interface ServicePrincipal extends JwtPayload {
  isApiKey:    true;
  apiKeyId:    string;
  /** The owner's name for the key: what the audit trail names as the actor. */
  apiKeyLabel: string;
  accessLevel: ApiAccessLevel;
  /** Empty for a key of the original kind (api-keys/scopes.ts). */
  scopes:      ApiKeyScope[];
}

/** True when this request came from a machine, not a person. */
export function isServicePrincipal(
  user: JwtPayload | undefined,
): user is ServicePrincipal {
  return !!user && (user as ServicePrincipal).isApiKey === true;
}

/**
 * The user id to stamp on records this principal creates. Service calls have
 * no User row, so this is null for them and the record is attributed via
 * `Order.createdByApiKeyId` instead. Always use this rather than `user.sub`
 * on any route that a service principal can reach — `sub` is the empty
 * string there and writing it to a FK column would fail.
 */
export function actorUserId(user: JwtPayload): string | null {
  return isServicePrincipal(user) ? null : user.sub;
}

/** Marks a creator-id column or an audit actor as "this API key", never a person. */
export const API_KEY_ACTOR_PREFIX = 'apikey:';

/**
 * The value to write into a creator column that cannot be null
 * (CycleCount.startedById, PurchaseRequest.createdById) or into
 * AuditLog.performedBy when an API key made the record: "apikey:<key id>".
 * Never a user id, so nothing is attributed to a person who did not act,
 * and a key id, not its label, so renaming a key cannot rewrite history.
 */
export function apiKeyActorId(keyId: string): string {
  return `${API_KEY_ACTOR_PREFIX}${keyId}`;
}

/** True for a creator / actor value written by apiKeyActorId. */
export function isApiKeyActor(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.startsWith(API_KEY_ACTOR_PREFIX);
}

/**
 * API-key auth for machine callers — the ecosystem apps that use Clerque as
 * a commerce/compliance backend, plus the public `/public-api/v1/*` surface.
 *
 * Implemented as a plain injectable (not a Passport strategy) to avoid
 * adding a new `passport-custom` dependency. Used by `ApiKeyGuard` and
 * `JwtOrApiKeyGuard`.
 *
 * Accepts a key either as:
 *   Authorization: Bearer clq_live_...
 *   X-API-Key: clq_live_...
 *
 * SECURITY — the principal is deliberately narrow:
 *   • role is 'SERVICE', which appears in no PERMISSION_MATRIX entry, so it
 *     can only reach routes that name 'SERVICE' in @Roles(...) explicitly.
 *     A key never inherits blanket access by being authenticated.
 *   • isSuperAdmin is always false. Every guard treats super-admin as a
 *     bypass, so a machine must never be one.
 *   • appAccess is POS-only and capped at OPERATOR, then narrowed again by
 *     the tenant's module flags. Ledger and Payroll stay NONE: an external
 *     app writes sales, and Clerque derives the books from them.
 *   • sub is '' — there is no user behind this call. Use actorUserId().
 *   • taxStatus / planCode come from the tenant record on every resolve, so
 *     a caller cannot assert its own tax treatment or entitlement.
 */
@Injectable()
export class ApiKeyStrategy {
  constructor(private readonly apiKeys: ApiKeysService) {}

  async authenticate(req: Request): Promise<ServicePrincipal> {
    const headerKey =
      (req.headers['x-api-key'] as string | undefined) ?? undefined;
    const auth = req.headers.authorization;
    let bearer: string | undefined;
    if (auth && auth.toLowerCase().startsWith('bearer ')) {
      bearer = auth.slice(7).trim();
    }
    const plaintext = headerKey ?? bearer;
    if (!plaintext) throw new UnauthorizedException('Missing API key.');

    const resolved = await this.apiKeys.resolveKey(plaintext);
    if (!resolved) throw new UnauthorizedException('Invalid or expired API key.');

    const flags = taxStatusFlags(resolved.taxStatus);

    return {
      // ── Machine identity ────────────────────────────────────────────────
      isApiKey:    true,
      apiKeyId:    resolved.keyId,
      apiKeyLabel: resolved.label,
      accessLevel: resolved.accessLevel,
      scopes:      resolved.scopes,

      // ── JwtPayload shape, so the normal guards work unchanged ───────────
      sub:          '',
      name:         `API key ${resolved.keyId.slice(0, 8)}`,
      tenantId:     resolved.tenantId,
      branchId:     resolved.defaultBranchId,
      role:         'SERVICE',
      isSuperAdmin: false,
      appAccess: [
        { app: 'POS',     level: resolved.modulePos ? 'OPERATOR' : 'NONE' },
        { app: 'LEDGER',  level: 'NONE' },
        { app: 'PAYROLL', level: 'NONE' },
      ],

      // ── Tenant tax context (server-owned; callers cannot assert it) ─────
      taxStatus:       resolved.taxStatus,
      isVatRegistered: flags.isVatRegistered,
      isBirRegistered: flags.isBirRegistered,
      businessName:    resolved.businessName,
      isPtuHolder:     false,

      // ── Entitlement ─────────────────────────────────────────────────────
      modulePos:     resolved.modulePos,
      moduleLedger:  resolved.moduleLedger,
      modulePayroll: resolved.modulePayroll,
      planCode:      resolved.planCode,
      planFeatures:  PLAN_FEATURES[resolved.planCode],
      planLimits:    PLAN_LIMITS[resolved.planCode],

      // No persona, no custom grants — a key cannot be escalated per-tenant.
      personaKey:        null,
      customPermissions: [],
    };
  }
}
