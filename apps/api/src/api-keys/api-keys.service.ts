import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import type { ApiAccessLevel, PlanCode } from '@repo/shared-types';
import { PLAN_FEATURES } from '@repo/shared-types';

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
    return { ok: true };
  }

  /**
   * Resolve a plaintext API key to a tenant + access level. Returns null on
   * any failure (expired, revoked, mismatch). Updates lastUsedAt async.
   */
  async resolveKey(plaintext: string): Promise<{
    tenantId:    string;
    keyId:       string;
    accessLevel: ApiAccessLevel;
  } | null> {
    if (!plaintext || !plaintext.startsWith('clq_live_')) return null;
    const keyPrefix = plaintext.slice(0, 12);

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
        tenant: { select: { planCode: true } },
      },
    });
    if (!candidates.length) return null;

    for (const row of candidates) {
      const match = await bcrypt.compare(plaintext, row.keyHash);
      if (match) {
        // Live tier gate: if the tenant downgraded out of API-eligible
        // plans, treat the key as revoked. The on-disk key.isActive flag
        // is the manual revoke; this is the automatic-on-downgrade revoke.
        const currentPlan = (row.tenant?.planCode ?? 'SOLO_LITE') as PlanCode;
        const planApi = PLAN_FEATURES[currentPlan]?.apiAccess ?? 'none';
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
        return {
          tenantId:    row.tenantId,
          keyId:       row.id,
          accessLevel: effective,
        };
      }
    }
    return null;
  }
}
