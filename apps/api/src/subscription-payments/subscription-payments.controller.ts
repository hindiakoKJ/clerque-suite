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
import { ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { type JwtPayload } from '@repo/shared-types';
import { SubscriptionPaymentsService } from './subscription-payments.service';

@ApiTags('Subscription Payments')
@Controller('subscription-payments')
export class SubscriptionPaymentsController {
  constructor(private readonly svc: SubscriptionPaymentsService) {}

  // ─── Public (no auth) ──────────────────────────────────────────────────

  /**
   * Customer looks up their pending payment by reference code.
   * Used by the /pay/<refCode> page during signup + renewal.
   */
  @Get('public/:referenceCode')
  async getByReference(@Param('referenceCode') referenceCode: string) {
    const payment = await this.svc.getByReferenceCode(referenceCode);
    // Strip server-side fields the customer shouldn't see
    return {
      referenceCode:  payment.referenceCode,
      planCode:       payment.planCode,
      amountPhpCents: payment.amountPhpCents,
      periodStart:    payment.periodStart,
      periodEnd:      payment.periodEnd,
      reason:         payment.reason,
      status:         payment.status,
      submittedAt:    payment.submittedAt,
      expiresAt:      payment.expiresAt,
      tenantName:     payment.tenant.name,
    };
  }

  /**
   * Customer submits proof of payment (transaction ID + optional screenshot URL).
   * Public endpoint — referenceCode is the access control (5-char alphabet).
   * Future hardening: rate-limit by IP.
   */
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
