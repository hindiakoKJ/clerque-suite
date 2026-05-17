import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';
import { DisplayPairingService } from '../../display-pairing/display-pairing.service';

/**
 * Sprint 25 — hybrid auth guard for surfaces that paired displays must
 * reach without a JWT (customer-display state polling + KDS station queue).
 *
 * Auth resolution order:
 *   1. Try the regular JWT bearer (cashier / owner logged in normally)
 *   2. If that fails, look for a deviceToken in `X-Device-Token` header OR
 *      in `Authorization: Bearer <token>` (32-hex). Resolve it via the
 *      DisplayPairingService and synthesize a minimal `req.user` mirroring
 *      JwtPayload.tenantId + sub so downstream code keeps working.
 *
 * A device token is granted by `/display-pairing/redeem` after a cashier-
 * generated 4-digit code is entered on the secondary device. It carries:
 *   - tenantId
 *   - cashierId (the user the device is tied to)
 *   - stationId (when bound to a KDS station)
 *   - role (CUSTOMER_DISPLAY / KDS_*)
 *
 * The synthesized req.user looks like:
 *   { sub: cashierId, tenantId, isDevice: true, deviceRole, stationId }
 */
@Injectable()
export class JwtOrDeviceTokenAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtAuthGuard,
    private readonly pairing: DisplayPairingService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();

    // 1. Try JWT first — fall back silently on failure.
    try {
      const ok = (await this.jwt.canActivate(ctx)) as boolean;
      if (ok && req.user) return true;
    } catch {
      // swallow — try device-token next
    }

    // 2. Device-token fallback.
    const header = String(req.headers['x-device-token'] ?? '').trim();
    let token = header;
    if (!token) {
      const auth = String(req.headers['authorization'] ?? '').trim();
      // 32-hex matches our randomDeviceToken format; anything else is JWT
      // (which would have been picked up above) or junk.
      if (auth.startsWith('Bearer ')) {
        const value = auth.slice(7).trim();
        if (/^[0-9a-f]{32}$/i.test(value)) token = value;
      }
    }
    if (!token) throw new UnauthorizedException('Missing JWT or device token.');

    const row = await this.pairing.resolveToken(token);
    if (!row) throw new UnauthorizedException('Device token revoked or invalid.');

    req.user = {
      sub:        row.createdById,
      tenantId:   row.tenantId,
      isDevice:   true,
      deviceRole: row.role,
      stationId:  row.stationId,
      // Synthesize a permissive but read-only role so any downstream
      // RBAC check that only cares about authentication (not edit perms)
      // still passes. Device endpoints should NOT lean on req.user.role
      // to authorise mutations — they should check req.user.isDevice
      // explicitly when sensitive.
      role: 'KIOSK_DISPLAY' as const,
    };
    return true;
  }
}
