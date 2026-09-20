import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { pairingCodeAttempts } from '../auth/pin-attempts';
import type { DisplayDeviceRole } from '@prisma/client';

/**
 * Sprint 25 — DisplayPairing service.
 *
 * A cashier-side device generates a single-use 4-digit code; a secondary
 * device (customer display TV, KDS, second tablet) redeems it and gets a
 * long-lived device token. The token authorises subsequent polls without
 * a user login — the secondary device is "tied to" the cashier that
 * created the code (its display stream / KDS station).
 */
@Injectable()
export class DisplayPairingService {
  constructor(private prisma: PrismaService) {}

  /**
   * Create a new pairing code on behalf of the cashier. Single-use,
   * expires in 15 minutes. The cashier hands the 4-digit code to the
   * person setting up the second device.
   *
   * If a pending (un-redeemed, un-expired) code already exists for the
   * same (createdById, role, stationId), return that one instead of
   * creating a fresh one — the cashier sees the same code on every tap.
   *
   * Every kitchen/bar (KDS_*) code must name one of this business's active
   * stations with its screen turned on. A KDS code without a station used to
   * be accepted: the tablet then opened /pos/station/generic, the queue call
   * failed with "Station not found", and the screen showed "All caught up"
   * forever while real tickets waited (and their ingredients stayed held).
   */
  async createCode(
    tenantId: string,
    createdById: string,
    role: DisplayDeviceRole,
    opts: { stationId?: string; label?: string } = {},
  ) {
    if (role !== 'CUSTOMER_DISPLAY') {
      await this.assertKdsStation(tenantId, opts.stationId);
    }

    // Reuse existing pending row when present
    const existing = await this.prisma.displayPairing.findFirst({
      where: {
        tenantId,
        createdById,
        role,
        stationId: opts.stationId ?? null,
        redeemedAt: null,
        revokedAt:  null,
        expiresAt:  { gt: new Date() },
      },
    });
    if (existing) return this.publicRow(existing, true);

    const code = randomFourDigitCode();
    // Collision-safe: 4-digit codes are scoped per tenant; retry up to 5x.
    for (let i = 0; i < 5; i++) {
      try {
        const row = await this.prisma.displayPairing.create({
          data: {
            tenantId,
            createdById,
            role,
            stationId:  opts.stationId ?? null,
            label:      opts.label ?? null,
            code:       i === 0 ? code : randomFourDigitCode(),
            expiresAt:  new Date(Date.now() + 15 * 60 * 1000),
          },
        });
        return this.publicRow(row, true);
      } catch (e: unknown) {
        // Unique constraint on (tenantId, code) — retry with a fresh code
        const err = e as { code?: string };
        if (err?.code === 'P2002') continue;
        throw e;
      }
    }
    throw new BadRequestException('Could not allocate a pairing code, try again.');
  }

  private async assertKdsStation(tenantId: string, stationId: string | undefined) {
    if (!stationId) {
      throw new BadRequestException(
        'Pick the station this screen is for, such as Kitchen or Bar, in Settings > Displays. ' +
          'A kitchen or bar screen with no station shows no orders.',
      );
    }
    const station = await this.prisma.station.findFirst({
      where:  { id: stationId, tenantId, isActive: true },
      select: { id: true, hasKds: true },
    });
    if (!station) {
      throw new BadRequestException('That station was not found. Refresh the page and pick the station again.');
    }
    if (!station.hasKds) {
      throw new BadRequestException(
        'That station has no screen turned on. Turn on its screen in Settings > Floor Layout, then try again.',
      );
    }
  }

  /**
   * Redeem a 4-digit code from a secondary device. Returns the device
   * token + the metadata the secondary device needs to render the right
   * surface (which cashier's stream to poll, which station, etc.).
   *
   * Called without authentication — the code itself is the auth.
   */
  async redeem(tenantSlug: string, code: string) {
    // The secondary device knows the tenant slug (entered on the pair
    // screen) but no JWT. Look the tenant up by slug.
    const tenant = await this.prisma.tenant.findFirst({
      where: { slug: tenantSlug.toLowerCase().trim() },
      select: { id: true, name: true },
    });
    if (!tenant) throw new NotFoundException('Tenant not found.');

    // The 4-digit code is the only secret here, so guesses are limited:
    // 10 failed codes in 15 minutes for this business, then a wait. Every
    // failure below (unknown, used, revoked, expired) counts; a good code
    // clears the count. Keyed on the real tenant id, never the typed slug.
    const attempt = pairingCodeAttempts.startTry(tenant.id);

    const row = await this.prisma.displayPairing.findUnique({
      where: { tenantId_code: { tenantId: tenant.id, code: code.trim() } },
    });
    if (!row)                                  throw new NotFoundException('Pairing code not found.');
    if (row.redeemedAt)                        throw new BadRequestException('Code already used.');
    if (row.revokedAt)                         throw new BadRequestException('Code revoked.');
    if (row.expiresAt.getTime() < Date.now()) throw new BadRequestException('Code expired — ask for a new one.');

    const deviceToken = randomDeviceToken();
    const updated = await this.prisma.displayPairing.update({
      where: { id: row.id },
      data: {
        deviceToken,
        redeemedAt: new Date(),
        lastSeenAt: new Date(),
      },
    });
    attempt.succeeded();
    return {
      deviceToken,
      tenantId:   updated.tenantId,
      tenantName: tenant.name,
      cashierId:  updated.createdById,
      role:       updated.role,
      stationId:  updated.stationId,
      label:      updated.label,
    };
  }

  /**
   * Resolve a device token to its pairing row. Used by guards on the
   * customer-display / KDS endpoints. Returns null on revoked, missing,
   * or never-redeemed tokens. Updates lastSeenAt async (don't block).
   */
  async resolveToken(token: string) {
    if (!token) return null;
    const row = await this.prisma.displayPairing.findUnique({
      where: { deviceToken: token },
      select: {
        id: true,
        tenantId: true,
        createdById: true,
        stationId: true,
        role: true,
        label: true,
        revokedAt: true,
        redeemedAt: true,
      },
    });
    if (!row || row.revokedAt || !row.redeemedAt) return null;
    // Fire-and-forget heartbeat
    void this.prisma.displayPairing.update({
      where: { id: row.id },
      data:  { lastSeenAt: new Date() },
    }).catch(() => undefined);
    return row;
  }

  /** List paired + pending devices for the cashier's tenant. */
  async list(tenantId: string) {
    const rows = await this.prisma.displayPairing.findMany({
      where: { tenantId, revokedAt: null },
      orderBy: [{ redeemedAt: 'desc' }, { createdAt: 'desc' }],
      take: 50,
    });
    return rows.map((r) => this.publicRow(r, false));
  }

  /** Revoke a paired (or pending) device. The owner of the cashier
   *  account or any management role can do this. */
  async revoke(tenantId: string, id: string) {
    const row = await this.prisma.displayPairing.findFirst({
      where: { id, tenantId },
    });
    if (!row) throw new NotFoundException('Pairing not found.');
    if (row.revokedAt) throw new BadRequestException('Already revoked.');
    await this.prisma.displayPairing.update({
      where: { id },
      data:  { revokedAt: new Date() },
    });
    return { ok: true };
  }

  private publicRow(
    row: { id: string; code: string; role: DisplayDeviceRole; stationId: string | null; label: string | null; expiresAt: Date; redeemedAt: Date | null; lastSeenAt: Date | null; createdAt: Date },
    includeCode: boolean,
  ) {
    return {
      id: row.id,
      code: includeCode ? row.code : null,
      role: row.role,
      stationId: row.stationId,
      label: row.label,
      expiresAt: row.expiresAt,
      redeemedAt: row.redeemedAt,
      lastSeenAt: row.lastSeenAt,
      createdAt: row.createdAt,
    };
  }
}

function randomFourDigitCode(): string {
  // crypto, not Math.random: the code is the secret, so it must not be predictable.
  return String(crypto.randomInt(1000, 10000));
}

function randomDeviceToken(): string {
  // 32 hex chars (~128 bits of entropy)
  return crypto.randomBytes(16).toString('hex');
}
