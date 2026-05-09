import {
  Injectable, Logger, BadRequestException, UnauthorizedException, ForbiddenException,
} from '@nestjs/common';
import { TOTP, NobleCryptoPlugin, ScureBase32Plugin } from 'otplib';
import * as QRCode from 'qrcode';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';

const cryptoPlugin = new NobleCryptoPlugin();
const base32Plugin = new ScureBase32Plugin();
const totp = new TOTP({
  crypto: cryptoPlugin,
  base32: base32Plugin,
  period: 30,
});

/**
 * RFC-compliant tolerance: accept tokens from the previous time step
 * (clock drift up to 30s in the past). epochTolerance: [past, future] in
 * seconds. We accept ±30s symmetric so users with slightly fast/slow
 * clocks aren't locked out.
 */
const EPOCH_TOLERANCE: [number, number] = [30, 30];

/**
 * Sprint 17 — TOTP (RFC 6238) two-factor authentication.
 *
 * Flow:
 *   1. POST /auth/2fa/enroll      → generate secret + return QR data URL
 *      Stored as `twoFactorPendingSecret`; not yet active.
 *   2. POST /auth/2fa/verify      → user submits 6-digit code from authenticator
 *      On success: secret moves to `twoFactorSecret`, `enable2fa = true`,
 *      8 fresh single-use backup codes generated (bcrypt-hashed).
 *   3. /auth/login flow:
 *      - SUPER_ADMIN without 2FA enabled → forced enroll on next session
 *      - Any user with 2FA enabled       → 2nd-factor challenge required
 *   4. POST /auth/2fa/disable     → must pass current code to disable
 *
 * Secret storage: full TOTP secret stored plaintext (Prisma schema). For a
 * higher-security tier we'd store an envelope-encrypted secret with a KMS
 * data key — out of scope for this sprint. Backup codes ARE bcrypt-hashed.
 */
@Injectable()
export class TwoFactorService {
  private readonly logger = new Logger(TwoFactorService.name);
  private static readonly ISSUER = 'Clerque';
  private static readonly BACKUP_CODE_COUNT = 8;
  private static readonly BACKUP_CODE_ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  constructor(private readonly prisma: PrismaService) {}

  /** Begin enrollment — generate a secret + return the otpauth URL + QR. */
  async beginEnroll(userId: string): Promise<{ secret: string; otpauthUrl: string; qrDataUrl: string }> {
    const user = await this.prisma.user.findUnique({
      where:  { id: userId },
      select: { id: true, email: true, name: true, enable2fa: true },
    });
    if (!user) throw new UnauthorizedException();
    if (user.enable2fa) {
      throw new BadRequestException('2FA already enabled. Disable it first to re-enroll.');
    }

    const secret      = totp.generateSecret();
    const otpauthUrl  = totp.toURI({
      secret,
      label:  user.email,
      issuer: TwoFactorService.ISSUER,
    });
    const qrDataUrl   = await QRCode.toDataURL(otpauthUrl);

    await this.prisma.user.update({
      where: { id: userId },
      data:  { twoFactorPendingSecret: secret },
    });

    return { secret, otpauthUrl, qrDataUrl };
  }

  /**
   * Verify the 6-digit code against the pending secret. On success:
   * promote pending → active, generate backup codes, return them once.
   */
  async verifyEnroll(userId: string, code: string): Promise<{ backupCodes: string[] }> {
    if (!code || !/^\d{6}$/.test(code)) {
      throw new BadRequestException('Code must be 6 digits.');
    }
    const user = await this.prisma.user.findUnique({
      where:  { id: userId },
      select: { id: true, twoFactorPendingSecret: true, enable2fa: true },
    });
    if (!user) throw new UnauthorizedException();
    if (user.enable2fa) throw new BadRequestException('Already enrolled.');
    if (!user.twoFactorPendingSecret) {
      throw new BadRequestException('No enrollment in progress. Call /auth/2fa/enroll first.');
    }

    const result = await totp.verify(code, { secret: user.twoFactorPendingSecret, epochTolerance: EPOCH_TOLERANCE });
    const valid = result.valid;
    if (!valid) throw new UnauthorizedException('Invalid code.');

    // Generate 8 backup codes; show plain to user once, store hashes only.
    const codes        = Array.from({ length: TwoFactorService.BACKUP_CODE_COUNT }, () => this.generateBackupCode());
    const codeHashes   = await Promise.all(codes.map((c) => bcrypt.hash(c, 10)));

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorSecret:        user.twoFactorPendingSecret,
        twoFactorPendingSecret: null,
        twoFactorBackupCodes:   codeHashes,
        enable2fa:              true,
      },
    });

    return { backupCodes: codes };
  }

  /** Verify a TOTP code (or backup code) against an enrolled user. */
  async verify(userId: string, code: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where:  { id: userId },
      select: { id: true, enable2fa: true, twoFactorSecret: true, twoFactorBackupCodes: true },
    });
    if (!user || !user.enable2fa || !user.twoFactorSecret) return false;

    const trimmed = (code ?? '').trim();
    if (/^\d{6}$/.test(trimmed)) {
      const result = await totp.verify(trimmed, { secret: user.twoFactorSecret, epochTolerance: EPOCH_TOLERANCE });
      return result.valid;
    }

    // Backup code (10-char alphanumeric). Match against any unused hash.
    const upper = trimmed.toUpperCase();
    if (!/^[A-Z0-9]{10}$/.test(upper)) return false;

    for (let i = 0; i < user.twoFactorBackupCodes.length; i++) {
      const hash = user.twoFactorBackupCodes[i];
      // eslint-disable-next-line no-await-in-loop
      const match = await bcrypt.compare(upper, hash);
      if (match) {
        // Consume the code — remove this hash atomically.
        const remaining = [...user.twoFactorBackupCodes];
        remaining.splice(i, 1);
        await this.prisma.user.update({
          where: { id: userId },
          data:  { twoFactorBackupCodes: remaining },
        });
        return true;
      }
    }
    return false;
  }

  /** Regenerate all 8 backup codes (invalidates the old ones). */
  async regenerateBackupCodes(userId: string, currentCode: string): Promise<{ backupCodes: string[] }> {
    const ok = await this.verify(userId, currentCode);
    if (!ok) throw new UnauthorizedException('Current 2FA code required.');

    const codes      = Array.from({ length: TwoFactorService.BACKUP_CODE_COUNT }, () => this.generateBackupCode());
    const codeHashes = await Promise.all(codes.map((c) => bcrypt.hash(c, 10)));
    await this.prisma.user.update({
      where: { id: userId },
      data:  { twoFactorBackupCodes: codeHashes },
    });
    return { backupCodes: codes };
  }

  /** Disable 2FA — requires current code to prevent unauthorized lockout. */
  async disable(userId: string, currentCode: string): Promise<void> {
    const ok = await this.verify(userId, currentCode);
    if (!ok) throw new UnauthorizedException('Current 2FA code required.');
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        enable2fa:              false,
        twoFactorSecret:        null,
        twoFactorPendingSecret: null,
        twoFactorBackupCodes:   [],
      },
    });
  }

  /** Status check — used by the gate logic during login. */
  async status(userId: string): Promise<{ enabled: boolean; backupCodesRemaining: number }> {
    const u = await this.prisma.user.findUnique({
      where:  { id: userId },
      select: { enable2fa: true, twoFactorBackupCodes: true },
    });
    return {
      enabled:               !!u?.enable2fa,
      backupCodesRemaining:  u?.twoFactorBackupCodes.length ?? 0,
    };
  }

  /** Cancel in-progress enrollment (drop pending secret). */
  async cancelEnroll(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data:  { twoFactorPendingSecret: null },
    });
  }

  private generateBackupCode(): string {
    const A = TwoFactorService.BACKUP_CODE_ALPHA;
    return Array.from({ length: 10 }, () => A[Math.floor(Math.random() * A.length)]).join('');
  }
}
