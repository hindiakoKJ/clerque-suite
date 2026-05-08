/**
 * /stub/:token — UNAUTHENTICATED public endpoint for the customer-facing
 * digital claim stub. Customer scans the QR on their paper ticket (or opens
 * an SMS link) and sees their order's current status.
 *
 * Security:
 *   - Token is unguessable: claim number + 4 random alphanums (no I/1/O/0).
 *   - Service returns minimal fields only: status, promised time, total,
 *     loyalty progress. Never returns full service-line detail or PII beyond
 *     the customer's own first name (which they already know).
 *   - Rate limiting / brute-force protection lives at the gateway. Until
 *     a global throttler ships (DEFERRED-6 in SECURITY_AUDIT), this endpoint
 *     trusts the front-of-line load balancer.
 *
 * Deliberately mounted on its OWN @Controller without JwtAuthGuard so anyone
 * with a valid token can hit it. Does NOT extend the laundry shell.
 */
import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { LaundryService } from './laundry.service';

@ApiTags('Laundry — Public Stub')
@Controller('stub')
export class PublicStubController {
  constructor(private readonly svc: LaundryService) {}

  @ApiOperation({ summary: 'Public claim-stub lookup (no auth required)' })
  @Get(':token')
  getStub(@Param('token') token: string) {
    return this.svc.getPublicStub(token);
  }
}
