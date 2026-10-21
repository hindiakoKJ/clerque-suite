/**
 * Sprint 24 — Subscription payment endpoints.
 *
 * Three audiences:
 *   1. Public (no auth) — customer looks up their pending payment by
 *      reference code, submits proof of payment via /pay/<ref>
 *   2. Owner/admin — verifies + confirms + issues OR via /admin/payments-pending
 *   3. Cron — internal, handled by the service's @Cron methods
 *
 * All amounts in PHP centavos in the API; frontend converts to display ₱.
 */
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { type JwtPayload } from '@repo/shared-types';
import { SubscriptionPaymentsService, publicPaymentView } from './subscription-payments.service';

/** An http(s) URL that parses; anything else (javascript:, data:, junk) is not. */
function isWebLink(raw: string): boolean {
  try {
    const u = new URL(raw.trim());
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

@ApiTags('Subscription Payments')
@Controller('subscription-payments')
export class SubscriptionPaymentsController {
  constructor(private readonly svc: SubscriptionPaymentsService) {}

  // ─── Public (no auth) ──────────────────────────────────────────────────

  /**
   * Public read of the platform's configured payment methods. Shown on the
   * /pay/<refCode> page so the customer can see Maya/BDO/Maribank options.
   * Returns the JSON array configured by the owner via /admin/platform/config.
   */
  @Get('public/payment-methods')
  async getPublicPaymentMethods() {
    const methods = await this.svc.getPublicPaymentMethods();
    return { methods };
  }

  /**
   * Customer looks up their pending payment by reference code.
   * Used by the /pay/<refCode> page during signup + renewal.
   *
   * The code is the only key, so guesses are held to 10 a minute per
   * address on this route (the global limit is 600). The page reads it once
   * on open and once after sending proof.
   */
  @Throttle({ short: { ttl: 60_000, limit: 10 } })
  @Get('public/:referenceCode')
  async getByReference(@Param('referenceCode') referenceCode: string) {
    const payment = await this.svc.getByReferenceCode(referenceCode);
    // Strip server-side fields the customer shouldn't see
    return publicPaymentView(payment);
  }

  /**
   * Customer submits proof of payment (transaction ID + optional screenshot URL).
   * Public endpoint — referenceCode is the access control (an unguessable
   * code, see subscription-payments.service.ts). Accepted once per payment.
   * 5 tries per 10 minutes per address: a real payer sends it once.
   */
  @Throttle({ short: { ttl: 600_000, limit: 5 } })
  @Post('public/:referenceCode/submit-proof')
  async submitProof(
    @Param('referenceCode') referenceCode: string,
    @Body() body: {
      submittedRefId:    string;
      submittedNotes?:   string;
      submittedMethod:   'MAYA' | 'BDO' | 'MARIBANK' | 'GCASH';
      submittedProofUrl?: string;
    },
  ) {
    if (!body.submittedRefId || body.submittedRefId.length < 3) {
      throw new BadRequestException('A valid transaction reference is required.');
    }
    if (!['MAYA', 'BDO', 'MARIBANK', 'GCASH'].includes(body.submittedMethod)) {
      throw new BadRequestException('Unsupported payment method.');
    }
    // The Console shows this link to the platform admin as "View receipt
    // screenshot", so only an ordinary web link may go in (never javascript:).
    if (body.submittedProofUrl && !isWebLink(body.submittedProofUrl)) {
      throw new BadRequestException('The screenshot link must start with http:// or https://.');
    }
    const updated = await this.svc.submitProof({ referenceCode, ...body });
    return {
      ok: true,
      status: updated.status,
      message: 'Thanks! We\'ll verify your payment within 4 business hours and confirm by email.',
    };
  }

  // ─── Owner / Super-admin ───────────────────────────────────────────────

  @Get('admin')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN')
  async listForAdmin(@Query('status') status?: string) {
    return this.svc.listForAdmin(
      status ? { status: status as any } : undefined,
    );
  }

  @Patch('admin/:id/confirm')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN')
  async confirm(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() body: { orNumber: string; scannedCopyUrl?: string },
  ) {
    if (!body.orNumber) {
      throw new BadRequestException('OR number is required.');
    }
    return this.svc.confirmPayment({
      pendingPaymentId: id,
      orNumber:         body.orNumber,
      scannedCopyUrl:   body.scannedCopyUrl,
      confirmedById:    user.sub,
    });
  }

  @Patch('admin/:id/reject')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN')
  async reject(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() body: { reason: string },
  ) {
    if (!body.reason || body.reason.trim().length < 5) {
      throw new BadRequestException('Rejection reason must be at least 5 characters.');
    }
    return this.svc.rejectPayment(id, user.sub, body.reason);
  }
}
