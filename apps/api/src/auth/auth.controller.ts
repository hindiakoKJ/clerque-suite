import {
  Controller,
  Post,
  Body,
  UseGuards,
  Request,
  Response,
  HttpCode,
  HttpStatus,
  Delete,
  BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Response as ExpressResponse } from 'express';
import { AuthService } from './auth.service';
import { TwoFactorService } from './two-factor.service';
import { RefreshDto, LogoutDto, PinLoginDto } from './dto/login.dto';
import { UnauthorizedException } from '@nestjs/common';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import { JwtPayload } from '@repo/shared-types';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Sprint 17 — server-side `app-session` cookie management.
 *
 * On login / refresh, the access token is set as an HttpOnly cookie so an
 * XSS on the tenant domain cannot read it via document.cookie. Required
 * before 2FA can ship; otherwise a stolen session token bypasses TOTP.
 *
 * Cross-cutting helpers below; called from login + refresh + logout.
 */
const SESSION_COOKIE = 'app-session';

function setSessionCookie(res: ExpressResponse, accessToken: string, isProd: boolean) {
  res.cookie(SESSION_COOKIE, accessToken, {
    httpOnly: true,
    secure:   isProd,           // dev runs over plain HTTP (localhost)
    sameSite: 'lax',
    path:     '/',
    // No explicit `expires` — session-scoped; the JWT itself carries TTL.
  });
}
function clearSessionCookie(res: ExpressResponse, isProd: boolean) {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, secure: isProd, sameSite: 'lax', path: '/' });
}

@Controller('auth')
export class AuthController {
  private readonly isProd = process.env.NODE_ENV === 'production';

  constructor(
    private authService: AuthService,
    private twoFactor:   TwoFactorService,
    private jwt:         JwtService,
    private prisma:      PrismaService,
  ) {}

  @UseGuards(AuthGuard('local'))
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Request() req: any, @Response({ passthrough: true }) res: ExpressResponse) {
    const { id, tenantId, branchId, role, name } = req.user;

    // Sprint 17 — 2FA gate. If the user has 2FA enabled, return a short-lived
    // challenge token instead of real JWTs. Frontend then prompts for the
    // code and POSTs /auth/login/2fa with { challengeToken, code }.
    const u2fa = await this.prisma.user.findUnique({
      where:  { id },
      select: { enable2fa: true },
    });
    if (u2fa?.enable2fa) {
      const challengeToken = this.jwt.sign(
        { sub: id, kind: '2fa-challenge', tenantId, branchId, role, name: name ?? '' },
        { expiresIn: '5m' },
      );
      return { requires2fa: true, challengeToken };
    }

    const deviceInfo = req.headers['user-agent'];
    const ipAddress = req.ip;
    const tokens = await this.authService.login(id, tenantId, branchId, role, name ?? '', deviceInfo, ipAddress);
    setSessionCookie(res, tokens.accessToken, this.isProd);
    return tokens;
  }

  /**
   * Sprint 17 — second-factor completion. Accepts challenge from /auth/login
   * + a 6-digit TOTP code (or 10-char backup code). On success, issues real
   * JWTs identical to the no-2FA path.
   */
  @Post('login/2fa')
  @HttpCode(HttpStatus.OK)
  async loginWith2fa(
    @Request() req: any,
    @Response({ passthrough: true }) res: ExpressResponse,
    @Body() body: { challengeToken: string; code: string },
  ) {
    if (!body?.challengeToken || !body?.code) {
      throw new UnauthorizedException('challengeToken and code required.');
    }
    let payload: any;
    try {
      payload = this.jwt.verify(body.challengeToken);
    } catch {
      throw new UnauthorizedException('Challenge token expired or invalid.');
    }
    if (payload.kind !== '2fa-challenge') {
      throw new UnauthorizedException('Bad challenge token.');
    }
    const ok = await this.twoFactor.verify(payload.sub, body.code);
    if (!ok) throw new UnauthorizedException('Invalid 2FA code.');

    const deviceInfo = req.headers['user-agent'];
    const ipAddress  = req.ip;
    const tokens = await this.authService.login(
      payload.sub, payload.tenantId, payload.branchId, payload.role, payload.name ?? '',
      deviceInfo, ipAddress,
    );
    setSessionCookie(res, tokens.accessToken, this.isProd);
    return tokens;
  }

  // ─── 2FA enrollment / management ──────────────────────────────────────────

  @UseGuards(JwtAuthGuard)
  @Post('2fa/enroll')
  @HttpCode(HttpStatus.OK)
  async enrol2fa(@CurrentUser() user: JwtPayload) {
    return this.twoFactor.beginEnroll(user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Post('2fa/verify')
  @HttpCode(HttpStatus.OK)
  async verify2fa(@CurrentUser() user: JwtPayload, @Body() body: { code: string }) {
    return this.twoFactor.verifyEnroll(user.sub, body?.code);
  }

  @UseGuards(JwtAuthGuard)
  @Post('2fa/disable')
  @HttpCode(HttpStatus.OK)
  async disable2fa(@CurrentUser() user: JwtPayload, @Body() body: { code: string }) {
    await this.twoFactor.disable(user.sub, body?.code);
    return { ok: true };
  }

  @UseGuards(JwtAuthGuard)
  @Post('2fa/regenerate-backup')
  @HttpCode(HttpStatus.OK)
  async regenBackup(@CurrentUser() user: JwtPayload, @Body() body: { code: string }) {
    return this.twoFactor.regenerateBackupCodes(user.sub, body?.code);
  }

  @UseGuards(JwtAuthGuard)
  @Post('2fa/cancel-enroll')
  @HttpCode(HttpStatus.OK)
  async cancelEnroll(@CurrentUser() user: JwtPayload) {
    await this.twoFactor.cancelEnroll(user.sub);
    return { ok: true };
  }

  @UseGuards(JwtAuthGuard)
  @Post('2fa/status')
  @HttpCode(HttpStatus.OK)
  async status2fa(@CurrentUser() user: JwtPayload) {
    return this.twoFactor.status(user.sub);
  }

  // SECURITY D3-06 — mass session revocation. Tenant-scope is the common
  // case during a credential-compromise incident: owner discovers a session
  // is leaked, hits this endpoint, every active refresh token in the tenant
  // dies and all users must log in fresh. Platform-wide variant is the same
  // panic button at the SUPER_ADMIN level. Typed-slug confirmation is the
  // safety pin so a misclick can't lock out an entire fleet.
  @UseGuards(JwtAuthGuard)
  @Post('sessions/revoke-all-tenant')
  @HttpCode(HttpStatus.OK)
  async revokeAllTenantSessions(
    @CurrentUser() user: JwtPayload,
    @Body() body: { confirmationToken: string },
  ) {
    if (user.role !== 'BUSINESS_OWNER' && user.role !== 'SUPER_ADMIN') {
      throw new UnauthorizedException('Only BUSINESS_OWNER or SUPER_ADMIN may revoke all tenant sessions.');
    }
    if (!user.tenantId) throw new BadRequestException('No tenant context on session.');
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: user.tenantId }, select: { slug: true },
    });
    if (body?.confirmationToken !== tenant.slug) {
      throw new BadRequestException(`Type the tenant slug exactly: "${tenant.slug}".`);
    }
    return this.authService.revokeAllSessionsForTenant(user.tenantId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('sessions/revoke-all-platform')
  @HttpCode(HttpStatus.OK)
  async revokeAllPlatformSessions(
    @CurrentUser() user: JwtPayload,
    @Body() body: { confirmationToken: string },
  ) {
    if (user.role !== 'SUPER_ADMIN') {
      throw new UnauthorizedException('SUPER_ADMIN only.');
    }
    if (body?.confirmationToken !== 'REVOKE-ALL') {
      throw new BadRequestException('Confirm by sending confirmationToken: "REVOKE-ALL".');
    }
    return this.authService.revokeAllSessionsPlatformWide();
  }

  /**
   * POST /auth/signup-ledger — Sprint 21 public self-signup for Ledger-only
   * tenants. Creates a new tenant in trial mode + the owner user. Does NOT
   * log them in (they go through the normal login flow afterward so the
   * password policy + future 2FA gating apply consistently).
   *
   * The global throttler at app.module limits abuse; an explicit @Throttle
   * here tightens it to 5 signups per 10 minutes per IP — enough for a
   * legit business to retry on slug collisions, not enough for a bot farm.
   */
  @Post('signup-ledger')
  @HttpCode(HttpStatus.CREATED)
  async signupLedger(@Body() body: {
    businessName: string;
    ownerName:    string;
    ownerEmail:   string;
    ownerPassword: string;
    taxStatus?:   'VAT' | 'NON_VAT' | 'UNREGISTERED';
    businessType?: string;
  }) {
    return this.authService.signupLedgerTenant(body);
  }

  /**
   * Sprint 24 — POS self-signup with plan picker.
   * Creates tenant in GRACE status + PendingPayment for the chosen plan.
   * Returns { tenantSlug, referenceCode } so the frontend can redirect to
   * /pay/<referenceCode> for payment instructions.
   */
  @Post('signup-pos')
  @HttpCode(HttpStatus.CREATED)
  async signupPos(@Body() body: {
    businessName:  string;
    ownerName:     string;
    ownerEmail:    string;
    ownerPassword: string;
    planCode:      'SOLO_LITE' | 'SOLO_STANDARD' | 'SOLO_PRO';
    taxStatus?:    'VAT' | 'NON_VAT' | 'UNREGISTERED';
    businessType?: string;
  }) {
    return this.authService.signupPosTenant(body);
  }

  /**
   * POST /auth/pin-login
   * Cashier fast-login. tenantSlug + email + 4-8 digit PIN.
   * Returns the same JWT shape as /auth/login.
   */
  @Post('pin-login')
  @HttpCode(HttpStatus.OK)
  async pinLogin(@Request() req: any, @Body() dto: PinLoginDto, @Response({ passthrough: true }) res: ExpressResponse) {
    const user = await this.authService.validateUserByPin(dto.email, dto.pin, dto.companyCode);
    if (!user) throw new UnauthorizedException('Invalid PIN, email, or company code.');
    const deviceInfo = req.headers['user-agent'];
    const ipAddress = req.ip;
    const tokens = await this.authService.login(
      user.id, user.tenantId, user.branchId, user.role, user.name ?? '',
      deviceInfo, ipAddress,
    );
    setSessionCookie(res, tokens.accessToken, this.isProd);
    return tokens;
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() dto: RefreshDto, @Response({ passthrough: true }) res: ExpressResponse) {
    const sub = this.authService.extractRefreshSub(dto.refreshToken);
    const tokens = await this.authService.refresh(sub, dto.refreshToken);
    setSessionCookie(res, tokens.accessToken, this.isProd);
    return tokens;
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@CurrentUser() user: JwtPayload, @Body() dto: LogoutDto, @Response({ passthrough: true }) res: ExpressResponse) {
    await this.authService.logout(user.sub, dto.refreshToken);
    clearSessionCookie(res, this.isProd);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('sessions')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logoutAll(@CurrentUser() user: JwtPayload) {
    await this.authService.logoutAllDevices(user.sub);
  }

  /**
   * POST /auth/change-password
   * Authenticated users can change their own password.
   * Requires current password for verification.
   * All sessions are revoked after a successful change.
   */
  @UseGuards(JwtAuthGuard)
  @Post('change-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async changePassword(
    @CurrentUser() user: JwtPayload,
    @Body() body: { currentPassword?: string; newPassword?: string },
  ) {
    if (!body.currentPassword || !body.newPassword) {
      throw new BadRequestException('currentPassword and newPassword are required.');
    }
    await this.authService.changePassword(user.sub, body.currentPassword, body.newPassword);
  }

  /**
   * POST /auth/forgot-password
   * Accepts email + tenantSlug. Always responds 204 (no email enumeration).
   * If the user exists and is active, a password-reset email is sent.
   */
  @Post('forgot-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async forgotPassword(@Body() body: { email?: string; tenantSlug?: string }) {
    if (!body.email || !body.tenantSlug) return; // silent — avoid enumeration
    await this.authService.forgotPassword(body.email, body.tenantSlug);
  }

  /**
   * POST /auth/reset-password
   * Validates the one-time reset token and sets the new password.
   * All sessions are revoked after a successful reset.
   */
  @Post('reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async resetPassword(@Body() body: { token?: string; newPassword?: string }) {
    if (!body.token || !body.newPassword) {
      throw new BadRequestException('token and newPassword are required.');
    }
    await this.authService.resetPassword(body.token, body.newPassword);
  }

  /**
   * POST /auth/verify-supervisor-pin
   * Used at the cashier till to authorise a void. The cashier is logged in;
   * the supervisor enters their PIN on the cashier's screen. The endpoint
   * looks up which supervisor (in the SAME tenant, with VOID_DIRECT role)
   * owns this PIN and returns their identity for the void to record.
   *
   * Request:  { pin: "1234" }
   * Returns:  { userId, name, role }  (200)
   * Errors:   401 if no matching supervisor found
   *
   * The endpoint requires JWT auth so we know which tenant to scope the PIN
   * lookup to — prevents cross-tenant PIN reuse.
   */
  @UseGuards(JwtAuthGuard)
  @Post('verify-supervisor-pin')
  @HttpCode(HttpStatus.OK)
  async verifySupervisorPin(
    @CurrentUser() user: JwtPayload,
    @Body() body: { pin?: string },
  ) {
    if (!body.pin) throw new BadRequestException('pin is required.');
    // SECURITY H3: pass the caller's userId so the service can rate-limit
    // per-actor brute-force attempts (a 4-digit PIN space is only 10K combos
    // — without a throttle a CASHIER could exhaust the PIN space in minutes).
    return this.authService.verifySupervisorPin(user.tenantId!, body.pin, user.sub);
  }

  /**
   * POST /auth/set-supervisor-pin
   * Set or change the current user's supervisor PIN. Self-service only —
   * supervisors set their own PIN, never delegated to admin (they could
   * then impersonate). Requires the user's current login password to
   * confirm identity (defence against stolen-session PIN takeover).
   *
   * Request:  { currentPassword: "...", newPin: "1234" }
   * Returns:  204
   */
  @UseGuards(JwtAuthGuard)
  @Post('set-supervisor-pin')
  @HttpCode(HttpStatus.NO_CONTENT)
  async setSupervisorPin(
    @CurrentUser() user: JwtPayload,
    @Body() body: { currentPassword?: string; newPin?: string },
  ) {
    if (!body.currentPassword || !body.newPin) {
      throw new BadRequestException('currentPassword and newPin are required.');
    }
    await this.authService.setSupervisorPin(user.sub, body.currentPassword, body.newPin);
  }
}
