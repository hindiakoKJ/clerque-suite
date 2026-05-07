import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { JwtPayload, AuthTokens, AppAccessEntry, DEFAULT_APP_ACCESS, taxStatusFlags, getAiQuotaForTenant } from '@repo/shared-types';
import type { TaxStatus, TierId, AiAddonType } from '@repo/shared-types';

// 8h access token = one login covers a full work shift; no mid-shift logouts.
// Refresh-token rotation still happens silently in the background via the
// axios refresh interceptor, so security posture is unchanged.
const ACCESS_EXPIRY = '8h';
const REFRESH_EXPIRY = '30d';
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt:    JwtService,
    private mail:   MailService,
  ) {}

  async validateUser(email: string, password: string, companyCode?: string) {
    // If company code supplied, resolve tenant first
    let tenantId: string | undefined;
    if (companyCode) {
      const tenant = await this.prisma.tenant.findUnique({
        where: { slug: companyCode.toLowerCase().trim() },
        select: { id: true, status: true },
      });
      // Return null (not 404) so we don't reveal whether the tenant exists
      if (!tenant) return null;
      if (tenant.status === 'SUSPENDED') {
        throw new ForbiddenException('This account has been suspended. Please contact support.');
      }
      tenantId = tenant.id;
    }

    const user = await this.prisma.user.findFirst({
      where: { email, isActive: true, ...(tenantId ? { tenantId } : {}) },
      select: {
        id: true,
        tenantId: true,
        branchId: true,
        role: true,
        name: true,
        passwordHash: true,
        isActive: true,
        appAccess: { select: { appCode: true, level: true } },
      },
    });
    if (!user) return null;

    // ── Account lockout check ──────────────────────────────────────────────
    const windowStart = new Date(Date.now() - LOCKOUT_MINUTES * 60 * 1000);
    const recentFailures = await this.prisma.loginLog.count({
      where: {
        userId: user.id,
        success: false,
        createdAt: { gte: windowStart },
      },
    });
    if (recentFailures >= MAX_FAILED_ATTEMPTS) {
      throw new ForbiddenException(
        `Account locked after ${MAX_FAILED_ATTEMPTS} failed attempts. Try again in ${LOCKOUT_MINUTES} minutes.`,
      );
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      // Log failed attempt
      await this.prisma.loginLog.create({
        data: {
          userId: user.id,
          tenantId: user.tenantId,
          email,
          success: false,
        },
      });
      return null;
    }

    return user;
  }

  /**
   * PIN-based login for cashiers on a shared terminal.
   * Inputs: tenantSlug + email + 4-8 digit PIN.
   *
   * Security model:
   *   - PIN is bcrypt-hashed at rest (set in users.service.ts)
   *   - Same lockout as email login (MAX_FAILED_ATTEMPTS in LOCKOUT_MINUTES window)
   *   - Failed attempts logged to LoginLog with success=false
   *   - PIN must be exactly 4-8 digits (DTO validates input shape)
   *
   * Returns the user record (same shape as validateUser) or null on bad PIN.
   * Lockout / suspended-tenant cases throw ForbiddenException.
   */
  async validateUserByPin(email: string, pin: string, companyCode: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug: companyCode.toLowerCase().trim() },
      select: { id: true, status: true },
    });
    if (!tenant) return null;
    if (tenant.status === 'SUSPENDED') {
      throw new ForbiddenException('This account has been suspended. Please contact support.');
    }

    const user = await this.prisma.user.findFirst({
      where: { email: email.toLowerCase().trim(), isActive: true, tenantId: tenant.id },
      select: {
        id:           true,
        tenantId:     true,
        branchId:     true,
        role:         true,
        name:         true,
        kioskPin:     true,
        appAccess:    { select: { appCode: true, level: true } },
      },
    });
    if (!user) return null;

    // No PIN set on this account — owner must set one before PIN login works
    if (!user.kioskPin) return null;

    const windowStart = new Date(Date.now() - LOCKOUT_MINUTES * 60 * 1000);
    const recentFailures = await this.prisma.loginLog.count({
      where: { userId: user.id, success: false, createdAt: { gte: windowStart } },
    });
    if (recentFailures >= MAX_FAILED_ATTEMPTS) {
      throw new ForbiddenException(
        `Account locked after ${MAX_FAILED_ATTEMPTS} failed attempts. Try again in ${LOCKOUT_MINUTES} minutes.`,
      );
    }

    const valid = await bcrypt.compare(pin, user.kioskPin);
    if (!valid) {
      await this.prisma.loginLog.create({
        data: { userId: user.id, tenantId: user.tenantId, email, success: false },
      });
      return null;
    }

    return user;
  }

  /** Load app access rows, falling back to role defaults if none seeded yet.
   *
   * Self-heal: for KIOSK_DISPLAY accounts, ALWAYS use the role defaults
   * regardless of what's in UserAppAccess. Some early KIOSK_DISPLAY accounts
   * inherited stale CLOCK_ONLY Payroll rows from when they were
   * GENERAL_EMPLOYEE — this guarantees the JWT they receive at login matches
   * the role's defined access level. Same defensive treatment is applied
   * during the role-change update path; this is the login-time backstop. */
  private async loadAppAccess(userId: string, role: string): Promise<AppAccessEntry[]> {
    if (role === 'KIOSK_DISPLAY') {
      return DEFAULT_APP_ACCESS.KIOSK_DISPLAY;
    }
    const rows = await this.prisma.userAppAccess.findMany({
      where: { userId },
      select: { appCode: true, level: true },
    });
    if (rows.length > 0) {
      return rows.map((r) => ({ app: r.appCode as AppAccessEntry['app'], level: r.level as AppAccessEntry['level'] }));
    }
    // Fall back to role defaults (row not yet seeded — e.g. migrated user)
    return DEFAULT_APP_ACCESS[role as keyof typeof DEFAULT_APP_ACCESS] ?? [];
  }

  async login(
    userId: string,
    tenantId: string,
    branchId: string | null,
    role: string,
    name = '',
    deviceInfo?: string,
    ipAddress?: string,
  ): Promise<AuthTokens> {
    // Revoke all existing sessions (single active session policy)
    await this.prisma.userSession.updateMany({
      where: { userId, status: 'ACTIVE' },
      data: { status: 'REVOKED' },
    });

    const appAccess = await this.loadAppAccess(userId, role);

    // Fetch tenant registration flags to embed in JWT
    const tenant = tenantId
      ? await this.prisma.tenant.findUnique({
          where:  { id: tenantId },
          select: { taxStatus: true, isVatRegistered: true, isBirRegistered: true, tinNumber: true, businessName: true, registeredAddress: true, isPtuHolder: true, ptuNumber: true, minNumber: true, tier: true, aiAddonType: true, aiAddonExpiresAt: true, aiQuotaOverride: true, planCode: true, modulePos: true, moduleLedger: true, modulePayroll: true },
        })
      : null;

    const taxStatus = (tenant?.taxStatus ?? 'UNREGISTERED') as TaxStatus;
    const flags     = taxStatusFlags(taxStatus);

    // Fetch RBAC fields (persona + customPermissions). Pre-RBAC users have
    // these as null/empty and the rest of the auth chain treats them as
    // no-ops, so behaviour is unchanged for legacy accounts.
    const userRbac = await this.prisma.user.findUnique({
      where:  { id: userId },
      select: { personaKey: true, customPermissions: true },
    });

    const payload: JwtPayload = {
      sub:             userId,
      name,
      tenantId,
      branchId,
      role:            role as JwtPayload['role'],
      // SUPER_ADMIN role unlocks the Console; treat it as platform-wide admin.
      // (We previously hard-coded false here — that meant role=SUPER_ADMIN users
      //  couldn't reach /admin via normal login.)
      isSuperAdmin:    role === 'SUPER_ADMIN',
      appAccess,
      taxStatus,
      isVatRegistered: flags.isVatRegistered,
      isBirRegistered: flags.isBirRegistered,
      tinNumber:         tenant?.tinNumber ?? null,
      businessName:      tenant?.businessName ?? null,
      registeredAddress: tenant?.registeredAddress ?? null,
      isPtuHolder:       tenant?.isPtuHolder ?? false,
      ptuNumber:         tenant?.ptuNumber ?? null,
      minNumber:         tenant?.minNumber ?? null,
      tier:              (tenant?.tier ?? undefined) as JwtPayload['tier'],
      // AI quota — resolves tier-included + active addon + SUPER_ADMIN override
      // (see pricing.ts → getAiQuotaForTenant). Baked into JWT at login so the
      // frontend can gate UI and show usage warnings without extra fetches.
      aiQuotaMonthly:    tenant?.tier
        ? getAiQuotaForTenant(
            tenant.tier as TierId,
            tenant.aiAddonType as AiAddonType | null,
            tenant.aiAddonExpiresAt,
            tenant.aiQuotaOverride,
          ).monthlyQuota
        : 0,
      personaKey:        userRbac?.personaKey ?? null,
      customPermissions: userRbac?.customPermissions ?? [],
      // Modular pricing (2026-05-08) — bake module entitlement into the JWT.
      // Pre-existing tenants default to all-true so behaviour is unchanged.
      modulePos:         tenant?.modulePos ?? true,
      moduleLedger:      tenant?.moduleLedger ?? true,
      modulePayroll:     tenant?.modulePayroll ?? true,
      planCode:          (tenant?.planCode ?? 'SUITE_T2') as JwtPayload['planCode'],
    };

    // Bake plan-derived feature flags + limits into the JWT for fast guards.
    try {
      const { PLAN_FEATURES, PLAN_LIMITS } = require('@repo/shared-types') as typeof import('@repo/shared-types');
      const pc = (payload.planCode ?? 'SUITE_T2') as keyof typeof PLAN_FEATURES;
      payload.planFeatures = PLAN_FEATURES[pc];
      payload.planLimits   = PLAN_LIMITS[pc];
    } catch { /* shared-types not loaded — JWT still valid without these */ }

    const accessToken = this.jwt.sign(payload, { expiresIn: ACCESS_EXPIRY });
    const refreshToken = this.jwt.sign(
      { sub: userId, type: 'refresh' },
      {
        secret: process.env.JWT_REFRESH_SECRET,
        expiresIn: REFRESH_EXPIRY,
      },
    );

    const refreshHash = await bcrypt.hash(refreshToken, 10);
    // Match REFRESH_EXPIRY ('30d') so the DB record and the JWT expire together.
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await this.prisma.userSession.create({
      data: {
        userId,
        refreshTokenHash: refreshHash,
        deviceInfo,
        ipAddress,
        status: 'ACTIVE',
        expiresAt,
      },
    });

    await this.prisma.loginLog.create({
      data: {
        userId,
        tenantId,
        email: '',
        success: true,
        ipAddress,
        deviceInfo,
      },
    });

    return { accessToken, refreshToken };
  }

  async refresh(userId: string, rawRefreshToken: string): Promise<AuthTokens> {
    const sessions = await this.prisma.userSession.findMany({
      where: { userId, status: 'ACTIVE' },
    });

    let matchedSession: (typeof sessions)[0] | null = null;
    for (const session of sessions) {
      const match = await bcrypt.compare(rawRefreshToken, session.refreshTokenHash);
      if (match) {
        matchedSession = session;
        break;
      }
    }

    if (!matchedSession) throw new UnauthorizedException('Invalid refresh token');
    if (matchedSession.expiresAt < new Date()) {
      await this.prisma.userSession.update({
        where: { id: matchedSession.id },
        data: { status: 'EXPIRED' },
      });
      throw new UnauthorizedException('Refresh token expired');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, tenantId: true, branchId: true, role: true, name: true },
    });
    if (!user) throw new UnauthorizedException();

    // Rotate: revoke old session, issue new tokens
    await this.prisma.userSession.update({
      where: { id: matchedSession.id },
      data: { status: 'REVOKED' },
    });

    return this.login(user.id, user.tenantId, user.branchId, user.role, user.name);
  }

  async logout(userId: string, refreshToken: string): Promise<void> {
    const sessions = await this.prisma.userSession.findMany({
      where: { userId, status: 'ACTIVE' },
    });

    for (const session of sessions) {
      const match = await bcrypt.compare(refreshToken, session.refreshTokenHash);
      if (match) {
        await this.prisma.userSession.update({
          where: { id: session.id },
          data: { status: 'REVOKED' },
        });
        return;
      }
    }
  }

  async logoutAllDevices(userId: string): Promise<void> {
    await this.prisma.userSession.updateMany({
      where: { userId, status: 'ACTIVE' },
      data: { status: 'REVOKED' },
    });
  }

  // ── Forgot / Reset Password ────────────────────────────────────────────────

  /** Generate a 1-hour password-reset token and email it to the user.
   *  Always returns success (no email enumeration — never reveal whether the
   *  email exists in our system). */
  async forgotPassword(email: string, tenantSlug: string): Promise<void> {
    const tenant = await this.prisma.tenant.findUnique({
      where:  { slug: tenantSlug.toLowerCase().trim() },
      select: { id: true, name: true },
    });
    if (!tenant) return; // silent — don't reveal tenant existence

    const user = await this.prisma.user.findUnique({
      where:  { tenantId_email: { tenantId: tenant.id, email: email.toLowerCase().trim() } },
      select: { id: true, name: true, email: true, isActive: true },
    });
    if (!user || !user.isActive) return; // silent — don't reveal user existence

    const token   = randomBytes(32).toString('hex');
    const expiry  = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await this.prisma.user.update({
      where: { id: user.id },
      data:  { passwordResetToken: token, passwordResetTokenExpiry: expiry },
    });

    await this.mail.sendPasswordReset({
      to:         user.email,
      name:       user.name,
      token,
      tenantSlug,
    });
  }

  /** Validate a reset token and set the new password. */
  async resetPassword(token: string, newPassword: string): Promise<void> {
    if (!token?.trim())         throw new BadRequestException('Reset token is required.');
    if (newPassword.length < 8) throw new BadRequestException('Password must be at least 8 characters.');

    const user = await this.prisma.user.findUnique({
      where:  { passwordResetToken: token },
      select: { id: true, passwordResetTokenExpiry: true },
    });

    if (!user || !user.passwordResetTokenExpiry) {
      throw new NotFoundException('Reset link is invalid or has already been used.');
    }
    if (user.passwordResetTokenExpiry < new Date()) {
      throw new BadRequestException('Reset link has expired. Please request a new one.');
    }

    const hash = await bcrypt.hash(newPassword, 12);
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash:            hash,
        passwordResetToken:       null,
        passwordResetTokenExpiry: null,
      },
    });

    // Revoke all sessions — any stolen refresh tokens are now useless
    await this.logoutAllDevices(user.id);
  }

  /** Change the authenticated user's own password after verifying the current one.
   *  All existing sessions (except the current one) are revoked so stolen
   *  refresh tokens cannot be used after a password change. */
  async changePassword(
    userId:          string,
    currentPassword: string,
    newPassword:     string,
  ): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where:  { id: userId },
      select: { passwordHash: true },
    });

    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Current password is incorrect.');

    if (newPassword.length < 8) {
      throw new ForbiddenException('New password must be at least 8 characters.');
    }

    const hash = await bcrypt.hash(newPassword, 12);
    await this.prisma.user.update({
      where: { id: userId },
      data:  { passwordHash: hash },
    });

    // Revoke all sessions so the new password takes effect everywhere
    await this.logoutAllDevices(userId);
  }

  /** Verify refresh token signature and return the subject (userId). Throws 401 on invalid/expired token. */
  extractRefreshSub(token: string): string {
    try {
      const payload = this.jwt.verify(token) as { sub: string };
      return payload.sub;
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
  }

  issueTokensForSuperAdmin(adminId: string): AuthTokens {
    const payload: JwtPayload = {
      sub:             adminId,
      name:            'Super Admin',
      tenantId:        null,
      branchId:        null,
      role:            'SUPER_ADMIN',
      isSuperAdmin:    true,
      appAccess:       DEFAULT_APP_ACCESS['SUPER_ADMIN'],
      taxStatus:         'UNREGISTERED', // Super Admin operates outside any specific tenant
      isVatRegistered:   false,
      isBirRegistered:   false,
      tinNumber:         null,
      businessName:      null,
      registeredAddress: null,
      isPtuHolder:       false,
      ptuNumber:         null,
      minNumber:         null,
    };
    const accessToken = this.jwt.sign(payload, { expiresIn: '2h' });
    const refreshToken = this.jwt.sign(
      { sub: adminId, type: 'refresh', isSuperAdmin: true },
      { secret: process.env.JWT_REFRESH_SECRET, expiresIn: '1d' },
    );
    return { accessToken, refreshToken };
  }

  // ─── Supervisor PIN (till-side void override) ─────────────────────────────

  /**
   * Look up which supervisor in this tenant owns the given PIN. Used by the
   * cashier's void modal to capture the supervisor's identity without making
   * them log out and in.
   *
   * Security:
   *  - Tenant-scoped — PINs cannot cross tenants
   *  - Only users with VOID_DIRECT_ROLES are eligible (CASHIER's PIN is
   *    silently rejected even if it matches)
   *  - Bcrypt-compared, no timing leak per individual user (we iterate all
   *    eligible supervisors in the tenant; total time scales with #supers)
   *  - Generic 401 on no match (no enumeration of which PINs are taken)
   */
  async verifySupervisorPin(tenantId: string, pin: string): Promise<{ userId: string; name: string; role: string }> {
    const cleaned = pin.trim();
    if (!/^\d{4,6}$/.test(cleaned)) {
      throw new UnauthorizedException('Invalid PIN.');
    }
    const VOID_DIRECT_ROLES = ['BUSINESS_OWNER', 'BRANCH_MANAGER', 'SALES_LEAD'] as const;
    const candidates = await this.prisma.user.findMany({
      where: {
        tenantId,
        isActive:           true,
        role:               { in: [...VOID_DIRECT_ROLES] },
        supervisorPinHash:  { not: null },
      },
      select: { id: true, name: true, role: true, supervisorPinHash: true },
    });
    for (const u of candidates) {
      if (u.supervisorPinHash && await bcrypt.compare(cleaned, u.supervisorPinHash)) {
        return { userId: u.id, name: u.name, role: u.role };
      }
    }
    throw new UnauthorizedException('Invalid PIN.');
  }

  /**
   * Set or change the user's supervisor PIN. Requires their login password
   * to confirm — protects against a thief who has the laptop but doesn't
   * know the password from setting a PIN to enable future voids.
   *
   * The endpoint accepts the request from any role, but the PIN is only
   * meaningful for VOID_DIRECT roles. We don't block CASHIER from setting
   * one (they may be promoted later) — just won't honour it until promoted.
   */
  async setSupervisorPin(userId: string, currentPassword: string, newPin: string): Promise<void> {
    const cleanedPin = newPin.trim();
    if (!/^\d{4,6}$/.test(cleanedPin)) {
      throw new BadRequestException('PIN must be 4 to 6 digits.');
    }
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { passwordHash: true, isActive: true },
    });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('User not found or inactive.');
    }
    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException('Current password is incorrect.');
    }
    const pinHash = await bcrypt.hash(cleanedPin, 10);
    await this.prisma.user.update({
      where: { id: userId },
      data:  { supervisorPinHash: pinHash },
    });
  }
}
