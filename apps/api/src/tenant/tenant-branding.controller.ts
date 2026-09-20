import { Controller, Get, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtOrDeviceTokenAuthGuard } from '../auth/guards/jwt-or-device-token.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TenantBranding, TenantLogoService } from './tenant-logo.service';

/** The pairing token shape JwtOrDeviceTokenAuthGuard accepts in Authorization. */
const DEVICE_TOKEN_PATTERN = /^[0-9a-f]{32}$/i;

interface BrandingRequest {
  user?:    { tenantId?: string | null; isDevice?: boolean };
  headers?: Record<string, string | string[] | undefined>;
}

/**
 * True when the request carried a sign-in token (anything in Authorization
 * other than a pairing token). A paired screen sends either nothing there or
 * its pairing token itself.
 */
function carriesSignInToken(req: BrandingRequest): boolean {
  const raw = req.headers?.authorization;
  const auth = (Array.isArray(raw) ? raw.join(',') : raw ?? '').trim();
  if (!auth) return false;
  if (!auth.startsWith('Bearer ')) return true;
  return !DEVICE_TOKEN_PATTERN.test(auth.slice(7).trim());
}

/**
 * GET /tenant/branding — the business name, logo link and placeholder
 * initials, for every screen that shows who the business is.
 *
 * Its own controller because TenantController is guarded by JwtAuthGuard at
 * class level, which would turn away a paired customer display or kitchen
 * screen before a method guard could accept its device token.
 *
 * Every signed-in staff role and every paired device may read it; no @Roles,
 * so RolesGuard only turns away API keys. The business is the one in the
 * token (or the device pairing), never one named in the request.
 *
 * This replaces the logo that used to ride in the login token, so a new logo
 * shows up without anyone signing out and back in.
 */
@ApiTags('Tenant')
@ApiBearerAuth('access-token')
@UseGuards(JwtOrDeviceTokenAuthGuard, RolesGuard)
@Controller('tenant')
export class TenantBrandingController {
  constructor(private readonly logoService: TenantLogoService) {}

  @Get('branding')
  getBranding(@Req() req: BrandingRequest): Promise<TenantBranding> {
    // The web app sends a stored screen pairing on every request, and the
    // guard quietly falls back to it when the sign-in token has expired. A
    // browser once paired for business A and now signed in for business B
    // would then get A's name and logo, filed under B. When a sign-in token
    // was sent, answer 401 instead so the page refreshes the sign-in and asks
    // again as the right business. Paired screens send no sign-in token.
    if (req.user?.isDevice && carriesSignInToken(req)) {
      throw new UnauthorizedException('Your sign-in has expired. Please sign in again.');
    }
    return this.logoService.getBranding(req.user?.tenantId);
  }
}
