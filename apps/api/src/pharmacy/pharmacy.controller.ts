import {
  Controller, Get, Post, Body, Param, Query,
  UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '@repo/shared-types';
import {
  PharmacyService,
  CreatePrescriptionDto,
  CreateLotDto,
  RecordControlledDispenseDto,
} from './pharmacy.service';

/**
 * Pharmacy / Compliance-Engine endpoints.
 *
 * Roles intended for a small Philippine pharmacy crew:
 *  - BUSINESS_OWNER         (the pharmacy proprietor)
 *  - BRANCH_MANAGER         (multi-branch chain pharmacies)
 *  - SALES_LEAD / CASHIER   (front-counter dispensing under a pharmacist)
 *  - GENERAL_EMPLOYEE       (assistants — read-only on the register)
 *
 * The dispensing-pharmacist credential check (PRC license + S2 number for
 * controlled drugs) happens INSIDE the service — role membership alone does
 * not authorize someone to dispense an Rx. Roles here are coarse access.
 */
@ApiTags('Pharmacy')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('pharmacy')
export class PharmacyController {
  constructor(private readonly svc: PharmacyService) {}

  private static readonly RX_OPS = [
    'BUSINESS_OWNER', 'SUPER_ADMIN', 'BRANCH_MANAGER',
    'SALES_LEAD', 'CASHIER', 'GENERAL_EMPLOYEE', 'MDM',
  ] as const;

  // ─── Pharmacist PIN-attest preview ─────────────────────────────────────────

  /**
   * Sprint 19 — Live PIN check for the till's Verify Rx modal. Looks up
   * User.kioskPin within the caller's tenant and returns the pharmacist's
   * name + PRC license if (a) the PIN matches, (b) the user is active, and
   * (c) they have a prcLicense on file. Otherwise returns valid:false plus
   * a coarse reason code (no enumeration of which staff exist).
   *
   * The PIN is RE-VALIDATED at order create time (see OrdersService) — this
   * preview is purely UX so the cart line shows the pharmacist's name
   * before the order POSTs.
   */
  @ApiOperation({ summary: 'Verify a pharmacist PIN for till Rx-attest preview' })
  @Roles(...PharmacyController.RX_OPS)
  @Get('verify-attest')
  verifyAttest(
    @CurrentUser() user: JwtPayload,
    @Query('pin') pin: string,
  ) {
    return this.svc.verifyAttestPin(user.tenantId!, pin ?? '');
  }

  // ─── Prescriptions ─────────────────────────────────────────────────────────

  @ApiOperation({ summary: 'Create a prescription record (intake from a doctor\'s Rx)' })
  @Roles(...PharmacyController.RX_OPS)
  @Post('prescriptions')
  @HttpCode(HttpStatus.CREATED)
  createRx(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreatePrescriptionDto,
  ) {
    return this.svc.createPrescription(user.tenantId!, dto);
  }

  @ApiOperation({ summary: 'List prescriptions (paginated, search by rxNumber/patientName)' })
  @Roles(...PharmacyController.RX_OPS)
  @Get('prescriptions')
  listRx(
    @CurrentUser() user: JwtPayload,
    @Query('customerId') customerId?: string,
    @Query('search')     search?:     string,
    @Query('take')       take?:       string,
    @Query('skip')       skip?:       string,
  ) {
    return this.svc.listPrescriptions(user.tenantId!, {
      customerId, search,
      take: take ? Number(take) : undefined,
      skip: skip ? Number(skip) : undefined,
    });
  }

  @ApiOperation({ summary: 'Get a single prescription with refill history' })
  @Roles(...PharmacyController.RX_OPS)
  @Get('prescriptions/:id')
  getRx(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.svc.getPrescription(user.tenantId!, id);
  }

  // ─── Product lots (FDA lot/expiry) ─────────────────────────────────────────

  @ApiOperation({ summary: 'Create a new product lot (FDA lot/expiry per branch)' })
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'BRANCH_MANAGER', 'WAREHOUSE_STAFF', 'MDM')
  @Post('lots')
  @HttpCode(HttpStatus.CREATED)
  createLot(@CurrentUser() user: JwtPayload, @Body() dto: CreateLotDto) {
    return this.svc.createLot(user.tenantId!, dto);
  }

  @ApiOperation({ summary: 'List available (FEFO-sorted) lots for a product at a branch' })
  @Roles(...PharmacyController.RX_OPS)
  @Get('lots/available')
  listAvailableLots(
    @CurrentUser() user: JwtPayload,
    @Query('productId') productId: string,
    @Query('branchId')  branchId:  string,
  ) {
    return this.svc.listAvailableLots(user.tenantId!, productId, branchId);
  }

  // ─── Controlled-substance register (RA 9165) ──────────────────────────────

  @ApiOperation({ summary: 'Append a DDB controlled-substance dispense record' })
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'BRANCH_MANAGER', 'SALES_LEAD', 'CASHIER')
  @Post('controlled-register')
  @HttpCode(HttpStatus.CREATED)
  recordControlled(
    @CurrentUser() user: JwtPayload,
    @Body() dto: RecordControlledDispenseDto,
  ) {
    return this.svc.recordControlledDispense(user.tenantId!, dto);
  }

  @ApiOperation({ summary: 'View the controlled-substance register (DDB-required, audit-only)' })
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'BRANCH_MANAGER')
  @Get('controlled-register')
  listControlled(
    @CurrentUser() user: JwtPayload,
    @Query('from') from?: string,
    @Query('to')   to?:   string,
    @Query('take') take?: string,
    @Query('skip') skip?: string,
  ) {
    return this.svc.listControlledRegister(user.tenantId!, {
      from, to,
      take: take ? Number(take) : undefined,
      skip: skip ? Number(skip) : undefined,
    });
  }
}
