import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { normalizePlanCode, planFeaturesFor } from '@repo/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { AuditService } from '../audit/audit.service';
import { brandingInitials, describeLogoForAudit, isAllowedLogoLink } from './logo-link';

/** Largest logo the server keeps. The web app shrinks it to about 512px first. */
export const MAX_LOGO_BYTES = 1024 * 1024;

/**
 * Accepted by what the bytes ARE, not by what the upload claims. SVG is never
 * accepted: the file is served from a no-login route on the API origin, and
 * an SVG can carry script.
 */
const LOGO_TYPES = {
  'image/png':  'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
} as const;
type LogoMime = keyof typeof LOGO_TYPES;

/**
 * On the DB storage driver a logo is a ProductPhoto row, which otherwise looks
 * exactly like a product photo nobody attached (productId null). This
 * originalName is how a logo row is told apart: any future clean-up of unused
 * photos must skip rows whose originalName starts with it, and a replaced logo
 * is only deleted when its row carries it.
 */
export const LOGO_FILE_MARKER = 'branding:tenant-logo';

export interface TenantBranding {
  name:         string;
  businessName: string | null;
  logoUrl:      string | null;
  initials:     string;
}

export interface UploadedLogoFile {
  buffer?:   Buffer;
  size?:     number;
  mimetype?: string;
}

function sniffLogoType(buf: Buffer): LogoMime | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

/**
 * The one business logo: upload, remove, and read for every screen.
 *
 * The tenant is always the caller's own, taken from the token by the
 * controller. Nothing here accepts a tenant id from the request.
 */
@Injectable()
export class TenantLogoService {
  private readonly logger = new Logger(TenantLogoService.name);

  constructor(
    private readonly prisma:   PrismaService,
    private readonly storage:  StorageService,
    private readonly audit:    AuditService,
  ) {}

  /** Name, business name, logo link and placeholder initials. */
  async getBranding(tenantId: string | null | undefined): Promise<TenantBranding> {
    if (!tenantId) throw new ForbiddenException('This account is not part of a business.');
    const tenant = await this.prisma.tenant.findUnique({
      where:  { id: tenantId },
      select: { name: true, businessName: true, receiptLogoUrl: true },
    });
    if (!tenant) throw new NotFoundException('Business not found.');
    const businessName = tenant.businessName?.trim() || null;
    return {
      name:         tenant.name,
      businessName,
      // An old inline data: logo (or any other link shape) counts as no logo,
      // so the screens fall back to initials instead of carrying the blob.
      logoUrl:      isAllowedLogoLink(tenant.receiptLogoUrl) ? tenant.receiptLogoUrl : null,
      initials:     brandingInitials(businessName, tenant.name),
    };
  }

  async upload(tenantId: string | null | undefined, actorId: string, file: UploadedLogoFile | undefined): Promise<{ logoUrl: string }> {
    if (!tenantId) throw new ForbiddenException('This account is not part of a business.');
    const buffer = file?.buffer;
    if (!buffer?.length) throw new BadRequestException('No picture was received. Choose a PNG, JPEG or WEBP image.');
    if (buffer.length > MAX_LOGO_BYTES || (file?.size ?? 0) > MAX_LOGO_BYTES) {
      throw new BadRequestException({ code: 'LOGO_TOO_LARGE', message: 'The logo must be 1 MB or smaller.' });
    }
    if (!file?.mimetype || !Object.prototype.hasOwnProperty.call(LOGO_TYPES, file.mimetype)) {
      throw new BadRequestException({
        code:    'LOGO_TYPE_NOT_ALLOWED',
        message: file?.mimetype === 'image/svg+xml'
          ? 'SVG logos are not accepted. Save the logo as a PNG and upload that.'
          : 'The logo must be a PNG, JPEG or WEBP image.',
      });
    }
    const mime = sniffLogoType(buffer);
    if (!mime) {
      throw new BadRequestException({
        code:    'LOGO_TYPE_NOT_ALLOWED',
        message: 'That file is not a PNG, JPEG or WEBP image.',
      });
    }

    const tenant = await this.prisma.tenant.findUnique({
      where:  { id: tenantId },
      select: { planCode: true, receiptLogoUrl: true },
    });
    if (!tenant) throw new NotFoundException('Business not found.');
    // Same gate PATCH /tenant/receipt-config applies to a logo link, so this
    // route is not a way around it.
    const planCode = normalizePlanCode(tenant.planCode);
    if (planFeaturesFor(planCode).receiptCustomization !== 'full') {
      throw new ForbiddenException({
        code:         'PLAN_FEATURE_TIER_INSUFFICIENT',
        feature:      'receiptCustomization',
        planCode,
        requiredTier: 'full',
        message:      'Your plan does not include a business logo.',
      });
    }

    const ext = LOGO_TYPES[mime];
    // A new id every time: the photo route caches for a year as immutable,
    // so a file is never overwritten in place.
    const key = `public/branding/${tenantId}/${crypto.randomBytes(12).toString('hex')}.${ext}`;
    await this.storage.putBuffer(buffer, key, {
      contentType:  mime,
      publicRead:   true,
      tenantId,
      originalName: `${LOGO_FILE_MARKER}.${ext}`,
    });
    const logoUrl = this.storage.getPublicUrl(key);
    // getBranding hands out only links that pass isAllowedLogoLink. If the
    // storage setup produces anything else (for example an http:// public
    // URL), saving it would report success for a logo no screen ever shows,
    // and later replacements could never find the file to delete it.
    if (!isAllowedLogoLink(logoUrl)) {
      await this.deleteQuietly(key);
      this.logger.error(`Logo not saved for tenant ${tenantId}: storage gave a link a screen may not show (${String(logoUrl).slice(0, 80)}). Check S3_PUBLIC_URL.`);
      throw new InternalServerErrorException('The logo could not be saved because file storage is not set up correctly. Please contact support.');
    }

    // Only replace the logo this upload started from. If another save landed
    // in between, keep that one and drop this file rather than orphan theirs.
    let swapped: number;
    try {
      const res = await this.prisma.tenant.updateMany({
        where: { id: tenantId, receiptLogoUrl: tenant.receiptLogoUrl },
        data:  { receiptLogoUrl: logoUrl },
      });
      swapped = res.count;
    } catch (err) {
      await this.deleteQuietly(key);
      throw err;
    }
    if (swapped === 0) {
      await this.deleteQuietly(key);
      throw new ConflictException('The logo was changed somewhere else at the same moment. Please try again.');
    }

    await this.releaseReplacedLogo(tenantId, tenant.receiptLogoUrl, logoUrl);
    await this.audit.log({
      tenantId,
      action:      'SETTING_CHANGED',
      entityType:  'Tenant',
      entityId:    tenantId,
      before:      { receiptLogoUrl: describeLogoForAudit(tenant.receiptLogoUrl) },
      after:       { receiptLogoUrl: logoUrl },
      description: 'Business logo uploaded',
      performedBy: actorId,
    }).catch(() => undefined);

    return { logoUrl };
  }

  async remove(tenantId: string | null | undefined, actorId: string): Promise<{ logoUrl: null }> {
    if (!tenantId) throw new ForbiddenException('This account is not part of a business.');
    const tenant = await this.prisma.tenant.findUnique({
      where:  { id: tenantId },
      select: { receiptLogoUrl: true },
    });
    if (!tenant) throw new NotFoundException('Business not found.');
    if (tenant.receiptLogoUrl == null) return { logoUrl: null };

    const res = await this.prisma.tenant.updateMany({
      where: { id: tenantId, receiptLogoUrl: tenant.receiptLogoUrl },
      data:  { receiptLogoUrl: null },
    });
    if (res.count === 0) {
      throw new ConflictException('The logo was changed somewhere else at the same moment. Please try again.');
    }
    await this.releaseReplacedLogo(tenantId, tenant.receiptLogoUrl, null);
    await this.audit.log({
      tenantId,
      action:      'SETTING_CHANGED',
      entityType:  'Tenant',
      entityId:    tenantId,
      before:      { receiptLogoUrl: describeLogoForAudit(tenant.receiptLogoUrl) },
      after:       { receiptLogoUrl: null },
      description: 'Business logo removed',
      performedBy: actorId,
    }).catch(() => undefined);
    return { logoUrl: null };
  }

  /**
   * Delete the stored file behind a logo link that is no longer in use.
   *
   * Only a file this business uploaded as its logo is ever deleted. A link can
   * be pasted through PATCH /tenant/receipt-config, so it may point at another
   * business's logo or at one of this business's product photos; those are
   * left alone. Never throws: the new logo is already saved, and a file left
   * behind costs a few KB.
   */
  async releaseReplacedLogo(tenantId: string, previousUrl: string | null | undefined, currentUrl: string | null | undefined): Promise<void> {
    if (!previousUrl || previousUrl === currentUrl) return;
    try {
      const key = await this.ownedLogoKey(tenantId, previousUrl);
      if (key) await this.storage.delete(key);
    } catch (err) {
      this.logger.warn(`Could not delete the replaced logo file for tenant ${tenantId}: ${(err as Error)?.message ?? err}`);
    }
  }

  /** The storage key behind `url` when it is this tenant's own uploaded logo, else null. */
  private async ownedLogoKey(tenantId: string, url: string): Promise<string | null> {
    if (!isAllowedLogoLink(url)) return null;
    const last = url.split('/').pop() ?? '';
    const match = /^([0-9a-f]{24})(?:\.(?:png|jpg|webp))?$/.exec(last);
    if (!match) return null;
    const key = `public/branding/${tenantId}/${last}`;
    // S3 and local links carry the tenant id in the path, so an exact match
    // against a key built from the caller's tenant proves it is theirs.
    if (this.storage.getPublicUrl(key) !== url) return null;
    if (this.storage.driverName === 'DB') {
      // The DB link is only /api/v1/products/photos/<id>: check the row.
      const row = await this.prisma.productPhoto.findFirst({
        where:  { id: match[1], tenantId, originalName: { startsWith: LOGO_FILE_MARKER } },
        select: { id: true },
      });
      if (!row) return null;
    }
    return key;
  }

  private async deleteQuietly(key: string): Promise<void> {
    await this.storage.delete(key).catch((err) => {
      this.logger.warn(`Could not delete unused logo file ${key}: ${(err as Error)?.message ?? err}`);
    });
  }
}
