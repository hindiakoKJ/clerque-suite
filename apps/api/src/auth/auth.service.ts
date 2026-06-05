import {
  Injectable,
  Optional,
  UnauthorizedException,
  ForbiddenException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { randomBytes, createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { AccountsService } from '../accounting/accounts.service';
import { SubscriptionPaymentsService } from '../subscription-payments/subscription-payments.service';
import { assertPasswordPolicy } from './password-policy';
import { JwtPayload, AuthTokens, AppAccessEntry, DEFAULT_APP_ACCESS, taxStatusFlags, getAiQuotaForTenant, PLAN_FEATURES, PLAN_LIMITS } from '@repo/shared-types';
import type { TaxStatus, TierId, AiAddonType, PlanCode } from '@repo/shared-types';

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
    private accounts: AccountsService,
    // Sprint 24 — Optional so legacy bootstraps and tests don't have to wire
    // SubscriptionPaymentsModule. When absent, signupPosTenant returns
    // referenceCode=null and the frontend renders a "contact support" fallback.
    @Optional()
    private subscriptionPayments?: SubscriptionPaymentsService,
  ) {}

  /**
   * SECURITY / Sprint 21 — Public Ledger self-signup.
   *
   * Creates a new tenant in Ledger-only trial mode (modulePos=false,
   * moduleLedger=true, modulePayroll=false). Plan defaults to STD_DUO (the
   * lowest tier that includes BIR forms). Seeds the LEDGER_ONLY Chart of
   * Accounts so the tenant lands with no POS-coupled accounts.
   *
   * The throttler at the app level rate-limits this endpoint along with
   * the others; specific tighter limits can be added at the controller
   * decorator if abuse becomes a problem.
   *
   * Does NOT auto-log the new owner in — they receive a welcome email and
   * go through normal login afterward. This keeps the surface aligned with
   * the standard auth flow (2FA gate, throttle, password-policy enforcement
   * on first login) and lets us send a "verify your email" link if we add
   * verification later.
   */
  async signupLedgerTenant(dto: {
    businessName: string;
    ownerName:    string;
    ownerEmail:   string;
    ownerPassword: string;
    /** Optional. Defaults to 'NON_VAT' which is the most common SME case. */
    taxStatus?:   'VAT' | 'NON_VAT' | 'UNREGISTERED';
    /** Optional. Defaults to 'SERVICE' since this is the Ledger-only audience. */
    businessType?: string;
  }): Promise<{ tenantId: string; tenantSlug: string; ownerUserId: string }> {
    const businessName = dto.businessName?.trim();
    const ownerName    = dto.ownerName?.trim();
    const ownerEmail   = dto.ownerEmail?.toLowerCase().trim();
    if (!businessName) throw new BadRequestException('Business name is required.');
    if (!ownerName)    throw new BadRequestException('Owner name is required.');
    if (!ownerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)) {
      throw new BadRequestException('Valid owner email is required.');
    }
    // Reuse the same password policy enforced on admin-created accounts.
    assertPasswordPolicy(dto.ownerPassword, { email: ownerEmail, name: ownerName });

    // Slug from business name, with collision-check + counter suffix.
    const baseSlug = businessName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 40) || 'tenant';
    let slug = baseSlug;
    for (let i = 1; i < 50; i++) {
      const exists = await this.prisma.tenant.findUnique({ where: { slug }, select: { id: true } });
      if (!exists) break;
      slug = `${baseSlug}-${i}`;
    }
    // Email-must-not-already-exist check. Reject loudly to avoid silently
    // creating a second account for the same person.
    const emailTaken = await this.prisma.user.findFirst({ where: { email: ownerEmail }, select: { id: true } });
    if (emailTaken) {
      throw new BadRequestException(
        'An account with this email already exists. Sign in instead, or use a different email.',
      );
    }

    const passwordHash = await bcrypt.hash(dto.ownerPassword, 12);

    // Sprint 23 — default Ledger-only signup lands on SOLO_STANDARD (₱399,
    // 3 seats). Previously STD_DUO; STD_DUO was deprecated in the Solo tier
    // redesign. SOLO_STANDARD has same price + same seat count so Ledger-SME
    // economics are identical, plus more features (unlimited recipes, 10
    // FEFO inventory slots, customer phone-lookup).
    const { PLAN_CAPS } = await import('@repo/shared-types');
    const planCode = 'SOLO_STANDARD' as const;
    const cap = PLAN_CAPS[planCode];

    const { DEFAULT_APP_ACCESS } = await import('@repo/shared-types');
    const appAccess = DEFAULT_APP_ACCESS['BUSINESS_OWNER'] ?? [];

    const result = await this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          name:         businessName,
          slug,
          // SERVICE is the default — owner can change later from Settings.
          businessType: (dto.businessType as 'SERVICE') ?? 'SERVICE',
          tier:         'TIER_2',
          taxStatus:    (dto.taxStatus ?? 'NON_VAT'),
          contactEmail: ownerEmail,
          status:       'ACTIVE',
          planCode,
          modulePos:        false,   // Ledger-only
          moduleLedger:     true,
          modulePayroll:    false,
          staffSeatQuota:   cap.baseSeats,
          staffSeatAddons:  0,
        },
      });

      const branch = await tx.branch.create({
        data: { tenantId: tenant.id, name: 'Main', isActive: true },
      });

      const user = await tx.user.create({
        data: {
          tenantId:     tenant.id,
          branchId:     branch.id,
          name:         ownerName,
          email:        ownerEmail,
          passwordHash,
          role:         'BUSINESS_OWNER',
          isActive:     true,
          appAccess: {
            // Cast deferred to Prisma's own types via `as any` because the
            // shared-types AccessLevel union pre-dates the schema enum
            // values (NONE | CLOCK_ONLY | READ_ONLY | OPERATOR | FULL) and
            // we don't want a cross-package refactor here. AdminService
            // creates accounts with the same shape via the same pattern.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            create: appAccess.map((a: { app: string; level: string }) => ({
              appCode: a.app as 'POS' | 'LEDGER' | 'PAYROLL',
              level:   a.level as any,
            })),
          },
        },
      });

      return { tenant, branch, user };
    });

    // Eager-seed the Ledger-only CoA so they don't have to wait for the
    // lazy back-fill on first /ledger/accounts open. Outside the
    // transaction because seedDefaultAccounts uses its own DB session.
    await this.accounts.seedDefaultAccounts(result.tenant.id, 'LEDGER_ONLY');

    // Welcome email (best-effort — failure here doesn't roll back signup).
    // The user picked their own password, so we don't echo it back — they
    // already know it. The mail's "Temp Password" line is replaced with
    // "(the password you just set)".
    try {
      await this.mail.sendWelcome({
        to:           result.user.email,
        name:         result.user.name,
        tenantName:   result.tenant.name,
        tenantSlug:   result.tenant.slug,
        tempPassword: '(the password you just set)',
        appName:      'LEDGER',
      });
    } catch {
      // Swallow — mail service may not be configured in dev. The signup
      // itself succeeded; the user can log in immediately with their
      // credentials.
    }

    return {
      tenantId:    result.tenant.id,
      tenantSlug:  result.tenant.slug,
      ownerUserId: result.user.id,
    };
  }

  /**
   * Sprint 24 — POS self-signup with plan picker + manual payment collection.
   *
   * Mirrors signupLedgerTenant but:
   *   - Customer picks SOLO_LITE / SOLO_STANDARD / SOLO_PRO (not defaulted)
   *   - Tenant created in GRACE status (limited access until payment confirmed)
   *   - Creates a PendingPayment for first month (NEW_SIGNUP reason)
   *   - Returns the reference code so the frontend can redirect to /pay/<ref>
   *
   * Owner verifies the deposit + issues OR via /admin/payments-pending,
   * at which point the tenant flips to ACTIVE.
   */
  async signupPosTenant(dto: {
    businessName:  string;
    ownerName:     string;
    ownerEmail:    string;
    ownerPassword: string;
    planCode:      'SOLO_LITE' | 'SOLO_STANDARD' | 'SOLO_PRO';
    taxStatus?:    'VAT' | 'NON_VAT' | 'UNREGISTERED';
    businessType?: string;
  }) {
    const businessName = dto.businessName?.trim() ?? '';
    const ownerName    = dto.ownerName?.trim() ?? '';
    const ownerEmail   = dto.ownerEmail?.trim().toLowerCase() ?? '';
    if (!businessName) throw new BadRequestException('Business name is required.');
    if (!ownerName)    throw new BadRequestException('Owner name is required.');
    if (!ownerEmail)   throw new BadRequestException('Owner email is required.');
    if (!dto.planCode) throw new BadRequestException('Plan is required.');
    if (!['SOLO_LITE', 'SOLO_STANDARD', 'SOLO_PRO'].includes(dto.planCode)) {
      throw new BadRequestException('Plan must be SOLO_LITE, SOLO_STANDARD, or SOLO_PRO.');
    }

    // Specialized verticals + service/manufacturing require Solo Standard or higher
    // (per excludedPlans in verticals.ts — Solo Lite's single-cashier cap is unrealistic
    // for these business types).
    const SOLO_LITE_EXCLUDED_BUSINESS_TYPES = ['PHARMACY', 'TRUCKING', 'CONSTRUCTION', 'MANUFACTURING'];
    if (dto.planCode === 'SOLO_LITE' && SOLO_LITE_EXCLUDED_BUSINESS_TYPES.includes(dto.businessType ?? '')) {
      throw new BadRequestException(
        `${dto.businessType?.toLowerCase().replace(/_/g, ' ')} businesses need at least Solo Standard. Please pick a higher tier or choose a different business type.`,
      );
    }

    // Enforce password policy (same as everywhere else)
    assertPasswordPolicy(dto.ownerPassword, { email: ownerEmail, name: ownerName });

    // Unique slug
    const baseSlug = businessName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 40) || 'tenant';
    let slug = baseSlug;
    for (let i = 1; i < 50; i++) {
      const exists = await this.prisma.tenant.findUnique({ where: { slug }, select: { id: true } });
      if (!exists) break;
      slug = `${baseSlug}-${i}`;
    }
    const emailTaken = await this.prisma.user.findFirst({ where: { email: ownerEmail }, select: { id: true } });
    if (emailTaken) {
      throw new BadRequestException(
        'An account with this email already exists. Sign in instead, or use a different email.',
      );
    }

    const passwordHash = await bcrypt.hash(dto.ownerPassword, 12);

    const { PLAN_CAPS, DEFAULT_APP_ACCESS } = await import('@repo/shared-types');
    const cap = PLAN_CAPS[dto.planCode];
    const appAccess = DEFAULT_APP_ACCESS['BUSINESS_OWNER'] ?? [];

    const result = await this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          name:         businessName,
          slug,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          businessType: (dto.businessType ?? 'RETAIL') as any,
          tier:         'TIER_2',
          taxStatus:    (dto.taxStatus ?? 'NON_VAT'),
          contactEmail: ownerEmail,
          // GRACE = limited access until payment confirmed.
          status:       'GRACE',
          planCode:     dto.planCode,
          modulePos:        true,   // Solo plans are POS-only
          moduleLedger:     false,
          modulePayroll:    false,
          staffSeatQuota:   cap.baseSeats,
          staffSeatAddons:  0,
        },
      });

      const branch = await tx.branch.create({
        data: { tenantId: tenant.id, name: 'Main', isActive: true },
      });

      const user = await tx.user.create({
        data: {
          tenantId:     tenant.id,
          branchId:     branch.id,
          name:         ownerName,
          email:        ownerEmail,
          passwordHash,
          role:         'BUSINESS_OWNER',
          isActive:     true,
          appAccess: {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            create: appAccess.map((a: { app: string; level: string }) => ({
              appCode: a.app as 'POS' | 'LEDGER' | 'PAYROLL',
              level:   a.level as any,
            })),
          },
        },
      });

      return { tenant, branch, user };
    });

    // Eager-seed POS Chart of Accounts so the cashier UI works post-payment.
    await this.accounts.seedDefaultAccounts(result.tenant.id);

    // Create the PendingPayment so the customer has a reference code +
    // gets the payment-instructions email immediately.
    let referenceCode: string | null = null;
    if (this.subscriptionPayments) {
      const now = new Date();
      const periodEnd = new Date(now);
      periodEnd.setMonth(periodEnd.getMonth() + 1);
      const pending = await this.subscriptionPayments.createPendingPayment({
        tenantId:    result.tenant.id,
        planCode:    dto.planCode,
        reason:      'NEW_SIGNUP',
        periodStart: now,
        periodEnd,
      });
      referenceCode = pending.referenceCode;
    }

    return {
      tenantId:      result.tenant.id,
      tenantSlug:    result.tenant.slug,
      ownerUserId:   result.user.id,
      referenceCode,
    };
  }

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

    // Find ALL active users matching this email (could be the same email
    // registered in multiple tenants). When companyCode is supplied, the
    // tenantId filter narrows to one. Without companyCode, we need a
    // deterministic + safe tie-breaker.
    const candidates = await this.prisma.user.findMany({
      where: { email, isActive: true, ...(tenantId ? { tenantId } : {}) },
      select: {
        id: true,
        tenantId: true,
        branchId: true,
        role: true,
        name: true,
        passwordHash: true,
        isActive: true,
        kioskOnly: true,
        tenant: { select: { status: true } },
        appAccess: { select: { appCode: true, level: true } },
      },
    });
    let user = candidates[0];
    if (!user) return null;
    if (candidates.length > 1) {
      // Same email exists in 2+ tenants and the caller didn't disambiguate
      // with companyCode. Prefer SUPER_ADMIN (HNS staff convenience login),
      // then fall back to rejecting — it's safer to force the caller to
      // specify a tenant than to log them into the "wrong" one silently.
      const superAdmin = candidates.find((c) => c.role === 'SUPER_ADMIN');
      if (superAdmin) {
        user = superAdmin;
      } else {
        throw new BadRequestException(
          'This email is registered in multiple companies. Please specify your Company Code.',
        );
      }
    }
    // Re-validate tenant.status when we resolved without companyCode (the
    // companyCode path already checked it above).
    if (!tenantId && user.tenant?.status === 'SUSPENDED') {
      throw new ForbiddenException('This account has been suspended. Please contact support.');
    }

    // Sprint 19 — Kiosk-only accounts cannot log in via password. They
    // exist for clock-in/out only at the shared kiosk tablet. Friendly
    // code so the frontend can show a tailored message.
    if (user.kioskOnly) {
      throw new ForbiddenException({
        code:    'KIOSK_ONLY_ACCOUNT',
        message: 'This account is for kiosk clock-in only. Punch your PIN at the kiosk tablet.',
      });
    }

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
   *   - PIN stored as plaintext (Sprint 19 — was bcrypt-hashed but that
   *     defeated kiosk lookups + the (tenantId, kioskPin) uniqueness
   *     constraint; PIN is a low-stakes shared-terminal credential).
   *   - Same lockout as email login (MAX_FAILED_ATTEMPTS in LOCKOUT_MINUTES window)
   *   - Failed attempts logged to LoginLog with success=false
   *   - PIN must be exactly 4-8 digits (DTO validates input shape)
   *   - kioskOnly accounts are rejected here too (only the kiosk endpoint
   *     accepts them; this path issues a JWT, which kiosk-only must not
   *     receive).
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
        kioskOnly:    true,
        appAccess:    { select: { appCode: true, level: true } },
      },
    });
    if (!user) return null;

    // No PIN set on this account — owner must set one before PIN login works
    if (!user.kioskPin) return null;

    // Kiosk-only accounts are NEVER issued JWTs, even via PIN login.
    if (user.kioskOnly) {
      throw new ForbiddenException({
        code:    'KIOSK_ONLY_ACCOUNT',
        message: 'This account is for kiosk clock-in only. Punch your PIN at the kiosk tablet.',
      });
    }

    const windowStart = new Date(Date.now() - LOCKOUT_MINUTES * 60 * 1000);
    const recentFailures = await this.prisma.loginLog.count({
      where: { userId: user.id, success: false, createdAt: { gte: windowStart } },
    });
    if (recentFailures >= MAX_FAILED_ATTEMPTS) {
      throw new ForbiddenException(
        `Account locked after ${MAX_FAILED_ATTEMPTS} failed attempts. Try again in ${LOCKOUT_MINUTES} minutes.`,
      );
    }

    // Plaintext exact match. Sprint 19 — was bcrypt.compare, which broke
    // when we switched kioskPin storage to plaintext.
    if (pin !== user.kioskPin) {
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
    /** When true, skip the "revoke all active sessions" step. Used by
     *  refresh() so multi-device sessions don't get cross-killed on each
     *  rotation. Login from a fresh credential always revokes (default). */
    skipRevokeAll = false,
  ): Promise<AuthTokens> {
    if (!skipRevokeAll) {
      await this.prisma.userSession.updateMany({
        where: { userId, status: 'ACTIVE' },
        data: { status: 'REVOKED' },
      });
    }

    const appAccess = await this.loadAppAccess(userId, role);

    // Fetch tenant registration flags to embed in JWT.
    // Defensive: if the DB schema hasn't been pushed since Sprint 9, the
    // planCode / module flag columns may not exist yet. Fall back to a
    // legacy-only select so the user can still log in and we can prompt
    // them to run `prisma db push`.
    let tenant: any = null;
    if (tenantId) {
      try {
        tenant = await this.prisma.tenant.findUnique({
          where:  { id: tenantId },
          select: { taxStatus: true, isVatRegistered: true, isBirRegistered: true, tinNumber: true, businessName: true, registeredAddress: true, isPtuHolder: true, ptuNumber: true, minNumber: true, tier: true, aiAddonType: true, aiAddonExpiresAt: true, aiQuotaOverride: true, planCode: true, modulePos: true, moduleLedger: true, modulePayroll: true, receiptHeaderNote: true, receiptFooterNote: true, receiptLogoUrl: true, allowSelfClockIn: true, returnsOwnerOnly: true },
        });
      } catch (err: any) {
        // PrismaClientValidationError or P2022 (column doesn't exist) means
        // schema drift — retry with the legacy field set. Log once for ops.
        // eslint-disable-next-line no-console
        console.warn('[auth] Tenant select failed for new fields; falling back to legacy fields. Run `prisma db push` to sync. Original error:', err?.message);
        tenant = await this.prisma.tenant.findUnique({
          where:  { id: tenantId },
          select: { taxStatus: true, isVatRegistered: true, isBirRegistered: true, tinNumber: true, businessName: true, registeredAddress: true, isPtuHolder: true, ptuNumber: true, minNumber: true, tier: true },
        });
      }
    }

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
      // Sprint 19 — receipt template fields baked into JWT for fast render
      receiptHeaderNote: tenant?.receiptHeaderNote ?? null,
      receiptFooterNote: tenant?.receiptFooterNote ?? null,
      receiptLogoUrl:    tenant?.receiptLogoUrl ?? null,
      // Sprint 19 — self-clock policy. Default false (kiosk-only) so the
      // frontend hides the Clock sidebar link unless explicitly enabled.
      allowSelfClockIn:  tenant?.allowSelfClockIn ?? false,
      // Sprint 19 — returns owner-only policy. Pharmacy tenants default true;
      // other verticals default false. Frontend uses this to hide the
      // Refund / Void buttons on the order detail page for non-owners.
      returnsOwnerOnly:  tenant?.returnsOwnerOnly ?? false,
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
      planCode:          (tenant?.planCode ?? 'SOLO_LITE') as JwtPayload['planCode'],
    };

    // Bake plan-derived feature flags + limits into the JWT for fast guards.
    // Imports are top-of-file so this runs synchronously without dynamic require()
    // (which fails silently in production NestJS bundles).
    const pc = (payload.planCode ?? 'SOLO_LITE') as PlanCode;
    payload.planFeatures = PLAN_FEATURES[pc];
    payload.planLimits   = PLAN_LIMITS[pc];

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

    // Rotate: revoke ONLY the matched session, then issue new tokens. Other
    // active sessions (e.g. user logged in on a second device) stay alive.
    await this.prisma.userSession.update({
      where: { id: matchedSession.id },
      data: { status: 'REVOKED' },
    });

    return this.login(
      user.id, user.tenantId, user.branchId, user.role, user.name,
      undefined, undefined, /* skipRevokeAll */ true,
    );
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

  /**
   * SECURITY D3-06 — Mass-session-revocation. Revoke EVERY active session
   * across an entire tenant (or, when tenantId is null, the whole platform).
   * Used during credential-compromise incident response: an attacker who
   * stole one refresh token can hold it for 30 days; this kills them all.
   *
   * Gated to SUPER_ADMIN + typed-slug confirmation at the controller layer.
   * Returns the count revoked for the audit log.
   */
  async revokeAllSessionsForTenant(tenantId: string): Promise<{ revoked: number }> {
    const result = await this.prisma.userSession.updateMany({
      where: { user: { tenantId }, status: 'ACTIVE' },
      data:  { status: 'REVOKED' },
    });
    return { revoked: result.count };
  }
  async revokeAllSessionsPlatformWide(): Promise<{ revoked: number }> {
    const result = await this.prisma.userSession.updateMany({
      where: { status: 'ACTIVE' },
      data:  { status: 'REVOKED' },
    });
    return { revoked: result.count };
  }

  /**
   * SECURITY D3-04 — Atomic employee deprovision. Single call that performs
   * every revocation an offboarding employee needs in one transaction:
   *   - Deactivate account (isActive = false)
   *   - Clear kioskPin (cannot punch in/out)
   *   - Clear supervisorPinHash (cannot authorize voids/refunds)
   *   - Clear twoFactor secrets (clean slate if re-hired)
   *   - Revoke all active refresh tokens
   *   - Stamp separatedAt + separationReason
   *
   * Replaces the prior "manually toggle isActive in the UI and pray" workflow.
   * Called from POST /users/:id/deprovision (owner-only).
   */
  async deprovisionUser(
    tenantId: string,
    userId: string,
    actorId: string,
    reason: string,
  ): Promise<{ ok: true; revokedSessions: number }> {
    const target = await this.prisma.user.findFirst({
      where:  { id: userId, tenantId },
      select: { id: true, isActive: true, role: true },
    });
    if (!target) throw new NotFoundException('User not found.');
    if (target.role === 'SUPER_ADMIN') {
      throw new ForbiddenException('SUPER_ADMIN cannot be deprovisioned via this endpoint.');
    }
    if (target.id === actorId) {
      throw new BadRequestException('You cannot deprovision yourself.');
    }
    const sessions = await this.prisma.$transaction(async (tx) => {
      const revoked = await tx.userSession.updateMany({
        where: { userId, status: 'ACTIVE' },
        data:  { status: 'REVOKED' },
      });
      await tx.user.update({
        where: { id: userId },
        data: {
          isActive:               false,
          kioskPin:               null,
          supervisorPinHash:      null,
          twoFactorSecret:        null,
          twoFactorPendingSecret: null,
          twoFactorBackupCodes:   [],
          enable2fa:              false,
          separatedAt:            new Date(),
          separationReason:       reason?.trim()?.slice(0, 240) ?? 'Deprovisioned',
        },
      });
      return revoked.count;
    });
    return { ok: true, revokedSessions: sessions };
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

    const token       = randomBytes(32).toString('hex');
    const tokenHash   = this.hashResetToken(token);
    const expiry      = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    // Sprint 17 — store the SHA-256 hash, not the raw token. If a DB dump
    // leaks, attackers can't directly use the rows to mint password-reset
    // links.
    await this.prisma.user.update({
      where: { id: user.id },
      data:  { passwordResetToken: tokenHash, passwordResetTokenExpiry: expiry },
    });

    // Email carries the plaintext token; user clicks the link, server
    // hashes the URL-passed token and looks up the matching row.
    await this.mail.sendPasswordReset({
      to:         user.email,
      name:       user.name,
      token,
      tenantSlug,
    });
  }

  /** Hash a reset token for at-rest storage. SHA-256 is sufficient — the
   *  pre-image is a 256-bit random; brute-force isn't feasible. */
  private hashResetToken(plaintext: string): string {
    return createHash('sha256').update(plaintext).digest('hex');
  }

  /** Validate a reset token and set the new password. */
  async resetPassword(token: string, newPassword: string): Promise<void> {
    if (!token?.trim()) throw new BadRequestException('Reset token is required.');

    // Sprint 17 — DB stores SHA-256 hash; lookup by hashed value.
    const tokenHash = this.hashResetToken(token);
    const user = await this.prisma.user.findUnique({
      where:  { passwordResetToken: tokenHash },
      select: { id: true, email: true, name: true, passwordResetTokenExpiry: true },
    });

    if (!user || !user.passwordResetTokenExpiry) {
      throw new NotFoundException('Reset link is invalid or has already been used.');
    }
    if (user.passwordResetTokenExpiry < new Date()) {
      throw new BadRequestException('Reset link has expired. Please request a new one.');
    }

    // SECURITY D3-05 — enforce password policy (12 char min, breach-corpus
    // check, no-email-reuse). Replaces the prior 8-char loose check.
    assertPasswordPolicy(newPassword, { email: user.email, name: user.name });

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
      select: { passwordHash: true, email: true, name: true },
    });

    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Current password is incorrect.');

    // SECURITY D3-05 — enforce password policy on every change.
    assertPasswordPolicy(newPassword, { email: user.email, name: user.name });

    const hash = await bcrypt.hash(newPassword, 12);
    await this.prisma.user.update({
      where: { id: userId },
      data:  { passwordHash: hash },
    });

    // Revoke all sessions so the new password takes effect everywhere
    await this.logoutAllDevices(userId);
  }

  /** Verify refresh token signature and return the subject (userId). Throws 401 on invalid/expired token.
   *
   *  SecAudit 2026-05 C1 — refresh tokens are signed with JWT_REFRESH_SECRET
   *  (see issueTokens), NOT the access secret JwtModule was registered with.
   *  Previously this verify call passed no override and silently used the
   *  access secret. Result: rotating JWT_REFRESH_SECRET had no effect, and
   *  the two secrets had no real separation. Explicit override below.
   */
  extractRefreshSub(token: string): string {
    try {
      const payload = this.jwt.verify(token, {
        secret: process.env.JWT_REFRESH_SECRET!,
      }) as { sub: string };
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
      // Super-admin has full module access + Enterprise-tier features.
      // PlanFeatureGuard already short-circuits on isSuperAdmin, but other
      // guards reading these fields directly would otherwise see undefined.
      modulePos:         true,
      moduleLedger:      true,
      modulePayroll:     true,
      planCode:          'ENTERPRISE',
      planFeatures:      PLAN_FEATURES.ENTERPRISE,
      planLimits:        PLAN_LIMITS.ENTERPRISE,
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
  /**
   * In-memory per-actor brute-force ledger. Acceptable for single-instance
   * Railway deployment; if we scale horizontally, swap for Redis or a DB
   * counter row. Entries auto-expire after WINDOW_MS so memory stays bounded.
   */
  private readonly supervisorPinAttempts = new Map<string, number[]>();
  private readonly SUPERVISOR_PIN_MAX_FAILS = 5;
  private readonly SUPERVISOR_PIN_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

  private recordPinAttempt(actorUserId: string, success: boolean) {
    if (success) {
      this.supervisorPinAttempts.delete(actorUserId);
      return;
    }
    const now = Date.now();
    const cutoff = now - this.SUPERVISOR_PIN_WINDOW_MS;
    const prev = (this.supervisorPinAttempts.get(actorUserId) ?? []).filter((t) => t > cutoff);
    prev.push(now);
    this.supervisorPinAttempts.set(actorUserId, prev);
  }

  private isPinActorLocked(actorUserId: string): boolean {
    const cutoff = Date.now() - this.SUPERVISOR_PIN_WINDOW_MS;
    const recent = (this.supervisorPinAttempts.get(actorUserId) ?? []).filter((t) => t > cutoff);
    return recent.length >= this.SUPERVISOR_PIN_MAX_FAILS;
  }

  async verifySupervisorPin(
    tenantId: string,
    pin: string,
    actorUserId?: string,
  ): Promise<{ userId: string; name: string; role: string }> {
    // SECURITY H3 — per-actor throttle. A 4-digit PIN space is only 10K
    // combos; without this, an authenticated CASHIER could harvest a
    // supervisor PIN in a few hours and then authorize their own voids.
    if (actorUserId && this.isPinActorLocked(actorUserId)) {
      throw new UnauthorizedException(
        'Too many supervisor-PIN attempts. Wait 15 minutes or have a supervisor log in.',
      );
    }
    const cleaned = pin.trim();
    if (!/^\d{4,6}$/.test(cleaned)) {
      if (actorUserId) this.recordPinAttempt(actorUserId, false);
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
    // Sprint 17 — collect ALL matches instead of returning the first one.
    // 4-digit PINs across a small team have a real collision probability;
    // attributing a void to the wrong supervisor in the audit log is
    // unacceptable. If 2+ users share the PIN, reject with a generic
    // error and require typed-email disambiguation (separate endpoint).
    const matches: typeof candidates = [];
    for (const u of candidates) {
      // eslint-disable-next-line no-await-in-loop
      if (u.supervisorPinHash && await bcrypt.compare(cleaned, u.supervisorPinHash)) {
        matches.push(u);
      }
    }
    if (matches.length === 0) {
      if (actorUserId) this.recordPinAttempt(actorUserId, false);
      throw new UnauthorizedException('Invalid PIN.');
    }
    if (matches.length > 1) {
      // Don't reveal which supervisors collided; just force disambiguation.
      // (Doesn't count as a "wrong PIN" attempt — they got it right, just
      //  ambiguously.)
      throw new UnauthorizedException(
        'PIN matched multiple supervisors. Please ask one of them to enter their email instead.',
      );
    }
    const u = matches[0];
    if (actorUserId) this.recordPinAttempt(actorUserId, true);
    return { userId: u.id, name: u.name, role: u.role };
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
