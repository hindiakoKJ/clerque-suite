/**
 * /stub/:token — UNAUTHENTICATED public endpoint for the customer-facing
 * digital claim stub. Customer scans the QR on their paper ticket (or opens
 * an SMS link) and sees their order's current status.
 *
 * Security:
 *   - Token is unguessable: 144 random bits, separate from the claim number
 *     (public-stub-token.ts). Tickets made before that carry the old
 *     claim number + 4 letters token and still open.
 *   - Service returns minimal fields only: status, promised time, total,
 *     loyalty progress. Never returns full service-line detail.
 *   - A tight per-address limit on this one route (below). The global limit
 *     is 600 a minute, which let a script try every old 4-letter suffix of a
 *     claim number in about a day.
 *
 * Deliberately mounted on its OWN @Controller without JwtAuthGuard so anyone
 * with a valid token can hit it. Does NOT extend the laundry shell.
 */
import { Controller, Get, Param } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { LaundryService } from './laundry.service';

@ApiTags('Laundry — Public Stub')
@Controller('stub')
export class PublicStubController {
  constructor(private readonly svc: LaundryService) {}

  // The stub page refreshes once a minute, so 20 a minute from one address
  // leaves room for a few customers behind the same mobile network, while a
  // guesser gets 20 tries a minute instead of 600.
  @Throttle({ short: { ttl: 60_000, limit: 20 } })
  @ApiOperation({ summary: 'Public claim-stub lookup (no auth required)' })
  @Get(':token')
  getStub(@Param('token') token: string) {
    return this.svc.getPublicStub(token);
  }
}
