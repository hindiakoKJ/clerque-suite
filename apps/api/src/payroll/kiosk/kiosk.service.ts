/**
 * Sprint 19 — Sync kiosk-mode terminal.
 *
 * Shared on-site clock-in/out device. Owner enrolls a tablet once via the
 * Settings UI; the tablet stores a long-lived apiKey in its URL, and any
 * employee can punch by typing their User.kioskPin on a fullscreen keypad.
 *
 * Security model:
 *   • The kiosk authenticates with apiKey (issued once at enrollment).
 *   • The user authenticates per-punch with their kioskPin (4–8 digits).
 *   • Wrong PIN → failedAttempts++. Hit MAX_FAILED → lockedUntil set
 *     LOCKOUT_MS into the future. Successful punch resets the counter.
 *   • Compromise scope of a stolen apiKey: punch-only, no read access to
 *     payroll data, no JWT, no other tenant. Rotate by revoking + re-issuing.
 */
import {
  Injectable, NotFoundException, ForbiddenException, BadRequestException,
  HttpException, HttpStatus,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TimeEntryStatus } from '@prisma/client';
import * as crypto from 'crypto';

const MAX_FAILED = 5;
const LOCKOUT_MS = 30_000; // 30 seconds — discourages brute-force without
                           // locking out legitimate fat-finger staff for long.

@Injectable()
export class KioskService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Tenant policy: allow self-service clock-in? ─────────────────────────

  async getSelfClockPolicy(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where:  { id: tenantId },
      select: { allowSelfClockIn: true },
    });
    return { allowSelfClockIn: tenant?.allowSelfClockIn ?? false };
  }

  async setSelfClockPolicy(tenantId: string, allow: boolean) {
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data:  { allowSelfClockIn: allow },
    });
    return { allowSelfClockIn: allow };
  }

  // ── Live roster: who is currently clocked in (anywhere via any path) ────

  async getRosterByApiKey(apiKey: string) {
    const kiosk = await this.prisma.kioskTerminal.findUnique({
      where:  { apiKey },
      select: { tenantId: true, branchId: true, isActive: true },
    });
    if (!kiosk || !kiosk.isActive) {
      throw new ForbiddenException('Kiosk is not active.');
    }

    // Currently-open TimeEntry rows joined to user info. If the kiosk is
    // branch-scoped, restrict the roster to that branch (otherwise show
    // every clocked-in employee in the tenant).
    const where: any = {
      tenantId: kiosk.tenantId,
      status:   TimeEntryStatus.OPEN,
    };
    if (kiosk.branchId) {
      where.user = {
        OR: [{ branchId: kiosk.branchId }, { branchId: null }],
      };
    }

    const entries = await this.prisma.timeEntry.findMany({
      where,
      orderBy: { clockIn: 'desc' },
      take:    20,
      select:  {
        id:      true,
        clockIn: true,
        user:    { select: { id: true, name: true, role: true } },
      },
    });

    return entries.map((e) => ({
      userId:      e.user.id,
      name:        e.user.name,
      role:        e.user.role,
      clockedInAt: e.clockIn.toISOString(),
    }));
  }

  // ── Enrollment / management (owner / manager) ───────────────────────────

  list(tenantId: string) {
    return this.prisma.kioskTerminal.findMany({
      where:   { tenantId },
      orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
      include: { branch: { select: { id: true, name: true } } },
    });
  }

  async create(tenantId: string, body: { name: string; branchId?: string | null }) {
    const name = body.name?.trim();
    if (!name) throw new BadRequestException('name is required');

    if (body.branchId) {
      const b = await this.prisma.branch.findFirst({
        where: { id: body.branchId, tenantId },
        select: { id: true },
      });
      if (!b) throw new BadRequestException('Branch does not belong to this tenant.');
    }

    const apiKey = this.makeApiKey();
    return this.prisma.kioskTerminal.create({
      data: {
        tenantId,
        branchId: body.branchId ?? null,
        name,
        apiKey,
      },
      include: { branch: { select: { id: true, name: true } } },
    });
  }

  async update(tenantId: string, id: string, body: Partial<{ name: string; isActive: boolean; branchId: string | null }>) {
    const existing = await this.prisma.kioskTerminal.findFirst({
      where: { id, tenantId }, select: { id: true },
    });
    if (!existing) throw new NotFoundException('Kiosk terminal not found.');

    if (body.branchId !== undefined && body.branchId !== null) {
      const b = await this.prisma.branch.findFirst({
        where: { id: body.branchId, tenantId },
        select: { id: true },
      });
      if (!b) throw new BadRequestException('Branch does not belong to this tenant.');
    }

    return this.prisma.kioskTerminal.update({
      where: { id },
      data:  {
        ...(body.name      !== undefined ? { name: body.name.trim() } : {}),
        ...(body.isActive  !== undefined ? { isActive: body.isActive } : {}),
        ...(body.branchId  !== undefined ? { branchId: body.branchId } : {}),
        // Reset throttle on any admin update.
        failedAttempts: 0,
        lockedUntil:    null,
      },
      include: { branch: { select: { id: true, name: true } } },
    });
  }

  async revoke(tenantId: string, id: string) {
    const existing = await this.prisma.kioskTerminal.findFirst({
      where: { id, tenantId }, select: { id: true },
    });
    if (!existing) throw new NotFoundException('Kiosk terminal not found.');
    // Rotate apiKey AND deactivate — the device on site immediately stops working.
    return this.prisma.kioskTerminal.update({
      where: { id },
      data:  { isActive: false, apiKey: this.makeApiKey() },
    });
  }

  // ── Public punch endpoint (UNAUTH; apiKey + PIN authenticate) ──────────

  /**
   * Punch a clock event. Auto-detects clock-in vs clock-out from the user's
   * latest open TimeEntry. Returns enough info for the kiosk UI to render
   * a confirmation card (name, action, timestamp).
   *
   * Errors are intentionally vague to avoid leaking which factor failed
   * (apiKey vs PIN) — we only want to confirm "we found you and recorded
   * the punch" or "no, retype".
   */
  async punch(apiKey: string, pin: string) {
    if (!apiKey || !pin) {
      throw new BadRequestException('apiKey and pin are required.');
    }
    if (!/^\d{4,8}$/.test(pin)) {
      throw new BadRequestException('PIN must be 4–8 digits.');
    }

    const kiosk = await this.prisma.kioskTerminal.findUnique({
      where:  { apiKey },
      select: { id: true, tenantId: true, branchId: true, isActive: true,
                failedAttempts: true, lockedUntil: true },
    });
    if (!kiosk || !kiosk.isActive) {
      // Don't disclose the difference — this is the only fail path that
      // could be probed without a valid apiKey.
      throw new ForbiddenException('Kiosk is not active.');
    }
    if (kiosk.lockedUntil && kiosk.lockedUntil > new Date()) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message:    'Too many wrong PINs. Try again in a few seconds.',
          retryAfterMs: kiosk.lockedUntil.getTime() - Date.now(),
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Find user by PIN within this tenant. Sprint 19 — PIN uniqueness is
    // enforced by a partial unique index on (tenantId, kioskPin), AND by
    // the create/update validators in users.service. The findMany +
    // length-check below is defence-in-depth: if duplicates ever sneak in
    // (e.g. raw SQL bypass), we fail closed instead of silently punching
    // for whoever sorted first.
    const userWhere: any = {
      tenantId: kiosk.tenantId,
      kioskPin: pin,
      isActive: true,
    };
    // If the kiosk is branch-scoped, only let users assigned to that branch
    // (or no branch — owners often have null branchId) clock in here.
    if (kiosk.branchId) {
      userWhere.OR = [
        { branchId: kiosk.branchId },
        { branchId: null },
      ];
    }
    const matches = await this.prisma.user.findMany({
      where:  userWhere,
      select: { id: true, name: true, role: true },
      take:   2, // we only need to detect "more than one"
    });

    if (matches.length === 0) {
      // Wrong PIN — bump throttle.
      await this.recordFailure(kiosk.id, kiosk.failedAttempts + 1);
      throw new ForbiddenException('Wrong PIN — try again.');
    }
    if (matches.length > 1) {
      // Should be impossible after migration 20260528000000_unique_kiosk_pin,
      // but if it ever happens, refuse rather than risk mis-attribution.
      throw new ForbiddenException(
        'Multiple staff share this PIN. Ask your manager to fix duplicate PINs in the staff page before clocking in.',
      );
    }
    const user = matches[0];

    // Determine clock-in vs clock-out. Reuse PayrollService logic shape:
    // any open entry for this user → close it. Otherwise → open a new one.
    const open = await this.prisma.timeEntry.findFirst({
      where:  { tenantId: kiosk.tenantId, userId: user.id, status: TimeEntryStatus.OPEN },
      orderBy: { clockIn: 'desc' },
      select: { id: true, clockIn: true },
    });

    let action: 'CLOCKED_IN' | 'CLOCKED_OUT';
    let at: Date;

    if (open) {
      // Clock out. Compute hours like PayrollService.clockOut() (no breaks
      // captured at the kiosk — staff can fix breaks in the Sync app later).
      const clockOut  = new Date();
      const totalMins = (clockOut.getTime() - open.clockIn.getTime()) / 60_000;
      const grossHours = +(totalMins / 60).toFixed(2);
      const otHours    = Math.max(grossHours - 8, 0);

      await this.prisma.timeEntry.update({
        where: { id: open.id },
        data: {
          clockOut,
          breakMins:  0,
          grossHours: grossHours as any,
          otHours:    otHours as any,
          status:     TimeEntryStatus.CLOSED,
          notes:      'Punched at kiosk',
        },
      });
      action = 'CLOCKED_OUT';
      at     = clockOut;
    } else {
      const entry = await this.prisma.timeEntry.create({
        data: {
          tenantId: kiosk.tenantId,
          userId:   user.id,
          clockIn:  new Date(),
          status:   TimeEntryStatus.OPEN,
          notes:    'Punched at kiosk',
        },
        select: { id: true, clockIn: true },
      });
      action = 'CLOCKED_IN';
      at     = entry.clockIn;
    }

    // Reset throttle on success + bump lastUsedAt for telemetry.
    await this.prisma.kioskTerminal.update({
      where: { id: kiosk.id },
      data:  { lastUsedAt: new Date(), failedAttempts: 0, lockedUntil: null },
    });

    return {
      action,
      at: at.toISOString(),
      user: { name: user.name, role: user.role },
    };
  }

  private async recordFailure(kioskId: string, nextCount: number) {
    const update: any = { failedAttempts: nextCount, lastUsedAt: new Date() };
    if (nextCount >= MAX_FAILED) {
      update.lockedUntil    = new Date(Date.now() + LOCKOUT_MS);
      update.failedAttempts = 0; // reset post-lockout so next valid PIN starts fresh
    }
    await this.prisma.kioskTerminal.update({ where: { id: kioskId }, data: update });
  }

  private makeApiKey(): string {
    // 32 hex chars = 128 bits of entropy, plenty for a per-device key.
    return crypto.randomBytes(16).toString('hex');
  }
}
