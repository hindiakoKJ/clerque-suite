import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import type { ApiAccessLevel, PlanCode, TaxStatus } from '@repo/shared-types';
import { normalizePlanCode, planFeaturesFor } from '@repo/shared-types';

/** How long a successfully-verified key stays cached. Also the worst-case
 *  delay before a revoke or plan downgrade takes effect. */
const API_KEY_CACHE_TTL_MS = 60_000;
const API_KEY_CACHE_MAX    = 500;

/**
 * Everything a request needs to act on behalf of a tenant without a user.
 * `ApiKeyStrategy` turns this into a JwtPayload-shaped service principal.
 */
export interface ResolvedApiKey {
  tenantId:    string;
  keyId:       string;
  accessLevel: ApiAccessLevel;
  planCode:    PlanCode;
  /** Drives VAT math — an external app must never tell us its own tax status. */
  taxStatus:   TaxStatus;
  businessName:    string | null;
  modulePos:       boolean;
  moduleLedger:    boolean;
  modulePayroll:   boolean;
  /** Tenant's first active branch; the fallback when a caller sends none. */
  defaultBranchId: string | null;
}

export interface IssuedApiKey {
  /** The plaintext key, only returned ONCE at creation time. */
  key:         string;
  id:          string;
  label:       string;
  keyPrefix:   string;
  accessLevel: ApiAccessLevel;
  expiresAt:   Date | null;
  createdAt:   Date;
}

@Injectable()
export class ApiKeysService {
  constructor(private prisma: PrismaService) {}

  /**
   * Issue a new API key. Format: `clq_live_<32 random base62 chars>`.
   * The plaintext is hashed with bcrypt for storage; we keep the first 12
   * chars (prefix) un-hashed so we can look up by prefix and bcrypt-compare
   * the remainder. Plaintext is returned exactly once.
   */
  async create(
    tenantId:    string,
    createdById: string,
    label:       string,
    accessLevel: ApiAccessLevel,
    expiresAt?:  Date | null,
  ): Promise<IssuedApiKey> {
    if (!label || !label.trim()) {
      throw new BadRequestException('Label is required.');
    }
    if (accessLevel !== 'read' && accessLevel !== 'readwrite') {
      throw new BadRequestException('accessLevel must be "read" or "readwrite".');
    }

    // 32 random alphanumeric chars — base64url then slice gives ~190 bits entropy.
    const random = crypto.randomBytes(24).toString('base64url').replace(/[-_]/g, '').slice(0, 32);
    const key      = `clq_live_${random}`;
    // First 12 chars of the full key are the "prefix" we display & index on.
    const keyPrefix = key.slice(0, 12); // "clq_live_xxx"
    const keyHash   = await bcrypt.hash(key, 12);

    const row = await this.prisma.apiKey.create({
      data: {
        tenantId,
        label:       label.trim(),
        keyPrefix,
        keyHash,
        accessLevel,
        createdById,
        expiresAt:   expiresAt ?? null,
      },
      select: {
        id:          true,
        label:       true,
        keyPrefix:   true,
        accessLevel: true,
        expiresAt:   true,
        createdAt:   true,
      },
    });

    return {
      key,
      id:          row.id,
      label:       row.label,
      keyPrefix:   row.keyPrefix,
      accessLevel: row.accessLevel as ApiAccessLevel,
      expiresAt:   row.expiresAt,
      createdAt:   row.createdAt,
    };
  }

  async list(tenantId: string) {
    return this.prisma.apiKey.findMany({
      where:   { tenantId },
      orderBy: { createdAt: 'desc' },
      select: {
        id:          true,
        label:       true,
        keyPrefix:   true,
        accessLevel: true,
        isActive:    true,
        lastUsedAt:  true,
        expiresAt:   true,
        createdAt:   true,
      },
    });
  }

  async revoke(tenantId: string, id: string) {
    const existing = await this.prisma.apiKey.findFirst({
      where:  { id, tenantId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('API key not found.');
    await this.prisma.apiKey.update({
      where: { id },
      data:  { isActive: false },
    });
    // Revoke must be immediate, not "immediate in up to 60 seconds".
    this.invalidateTenantCache(tenantId);
    return { ok: true };
  }

  /**
   * Resolve a plaintext API key to a tenant + access level. Returns null on
   * any failure (expired, revoked, mismatch). Updates lastUsedAt async.
   *
   * Also returns the tenant context a service principal needs (tax status,
   * module entitlement, default branch) so `ApiKeyStrategy` can build a
   * principal that the normal guards understand — see that file.
   */
  async resolveKey(plaintext: string): Promise<ResolvedApiKey | null> {
    if (!plaintext || !plaintext.startsWith('clq_live_')) return null;
    const keyPrefix = plaintext.slice(0, 12);

    // Every request re-runs a bcrypt cost-12 compare, which is ~100ms of CPU
    // by design. That is right for a login form and wrong for a machine
    // caller hitting us in a loop, so a verified key is cached briefly.
    // The cache is keyed on the full plaintext (never logged or persisted)
    // and lives 60s, which bounds how long a revoked key or a plan
    // downgrade can keep working.
    const cached = this.keyCache.get(plaintext);
    if (cached && cached.expiresAtMs > Date.now()) return cached.value;

    // Multiple rows can share a prefix (cryptographically unlikely but possible).
    const candidates = await this.prisma.apiKey.findMany({
      where: {
        keyPrefix,
        isActive: true,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } },
        ],
      },
      select: {
        id: true,
        tenantId: true,
        keyHash: true,
        accessLevel: true,
        // Sprint 25 — pull the tenant's CURRENT planCode so we can re-check
        // apiAccess on every request. Otherwise a key issued while the
        // tenant was Solo Pro (apiAccess: 'read') keeps working forever
        // after they downgrade to Solo Lite/Standard (apiAccess: 'none').
        //
        // The rest of the tenant fields build the service principal: tax
        // status drives VAT math, the module flags feed AppAccessGuard.
        tenant: {
          select: {
            planCode:      true,
            taxStatus:     true,
            businessName:  true,
            modulePos:     true,
            moduleLedger:  true,
            modulePayroll: true,
            branches: {
              where:   { isActive: true },
              orderBy: { createdAt: 'asc' },
              take:    1,
              select:  { id: true },
            },
          },
        },
      },
    });
    if (!candidates.length) return null;

    for (const row of candidates) {
      const match = await bcrypt.compare(plaintext, row.keyHash);
      if (match) {
        // Live plan gate: if the tenant's package no longer grants API
        // access, treat the key as revoked. The on-disk key.isActive flag is
        // the manual revoke; this is the automatic one.
        //
        // normalizePlanCode matters here more than anywhere else in the
        // codebase: this lookup used to default an unrecognised stored code
        // to the lowest plan, whose apiAccess is 'none' — which returned
        // null and surfaced to the caller as "Invalid or expired API key".
        // A legacy planCode string silently killed a working integration
        // with an error that pointed at the key.
        const currentPlan = normalizePlanCode(row.tenant?.planCode);
        const planApi = planFeaturesFor(currentPlan).apiAccess;
        if (planApi === 'none') return null;
        // If the stored accessLevel exceeds the current plan's grant
        // (e.g. key was issued at 'readwrite' but plan now only offers
        // 'read'), clamp to the lower of the two.
        const storedLevel = (row.accessLevel as ApiAccessLevel);
        const effective: ApiAccessLevel =
          storedLevel === 'readwrite' && planApi === 'read' ? 'read' : storedLevel;

        // Fire-and-forget lastUsedAt update.
        void this.prisma.apiKey.update({
          where: { id: row.id },
          data:  { lastUsedAt: new Date() },
        }).catch(() => undefined);
        const resolved: ResolvedApiKey = {
          tenantId:    row.tenantId,
          keyId:       row.id,
          accessLevel: effective,
          planCode:    currentPlan,
          taxStatus:   (row.tenant?.taxStatus ?? 'UNREGISTERED') as TaxStatus,
          businessName:  row.tenant?.businessName ?? null,
          // Undefined (legacy rows) means enabled — same convention
          // AppAccessGuard uses.
          modulePos:     row.tenant?.modulePos ?? true,
          moduleLedger:  row.tenant?.moduleLedger ?? true,
          modulePayroll: row.tenant?.modulePayroll ?? true,
          defaultBranchId: row.tenant?.branches?.[0]?.id ?? null,
        };
        this.rememberKey(plaintext, resolved);
        return resolved;
      }
    }
    return null;
  }

  /* ─── Resolved-key cache ─────────────────────────────────────────────── */

  private readonly keyCache = new Map<
    string,
    { value: ResolvedApiKey; expiresAtMs: number }
  >();

  private rememberKey(plaintext: string, value: ResolvedApiKey): void {
    // Bounded so a flood of bogus-but-valid-looking keys cannot grow the map
    // without limit. Entries are only ever written after a successful bcrypt
    // match, so this only ever holds real keys.
    if (this.keyCache.size >= API_KEY_CACHE_MAX) {
      const now = Date.now();
      for (const [k, v] of this.keyCache) {
        if (v.expiresAtMs <= now) this.keyCache.delete(k);
      }
      // Still full after expiry sweep — drop the oldest insert (Map preserves
      // insertion order) rather than refusing to cache.
      if (this.keyCache.size >= API_KEY_CACHE_MAX) {
        const oldest = this.keyCache.keys().next().value;
        if (oldest !== undefined) this.keyCache.delete(oldest);
      }
    }
    this.keyCache.set(plaintext, {
      value,
      expiresAtMs: Date.now() + API_KEY_CACHE_TTL_MS,
    });
  }

  /**
   * Drop cached entries for a tenant. Called on revoke so a revoked key stops
   * working immediately instead of at the end of its 60s cache window.
   */
  private invalidateTenantCache(tenantId: string): void {
    for (const [k, v] of this.keyCache) {
      if (v.value.tenantId === tenantId) this.keyCache.delete(k);
    }
  }
}
