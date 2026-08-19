import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  MaxLength,
  Matches,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export const LEDGER_MODES = ['FULL', 'SIMPLE'] as const;
export type LedgerModeValue = (typeof LEDGER_MODES)[number];

export const BUSINESS_TYPES = [
  // F&B group
  'COFFEE_SHOP', 'RESTAURANT', 'BAKERY', 'FOOD_STALL', 'BAR_LOUNGE', 'CATERING',
  // Non-F&B group
  'RETAIL', 'SERVICE', 'MANUFACTURING',
] as const;

export type BusinessTypeValue = (typeof BUSINESS_TYPES)[number];

export class UpdateTenantProfileDto {
  @IsOptional()
  @IsEnum(BUSINESS_TYPES)
  businessType?: BusinessTypeValue;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;

  /** Legacy TIN field (9-digit BIR format) */
  @IsOptional()
  @IsString()
  @Matches(/^\d{3}-\d{3}-\d{3}(-\d{3,5})?$/, {
    message: 'tin must be in BIR format: 000-000-000 or 000-000-000-00000',
  })
  tin?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  @IsOptional()
  @IsEmail()
  contactEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  contactPhone?: string;

  /** Sprint 19 — receipt template fields (owner-editable). */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  receiptHeaderNote?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  receiptFooterNote?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  receiptLogoUrl?: string;

  /** Sprint 19 — Returns/refunds owner-only policy. Pharmacy default true;
   *  others default false. Owner toggles in Settings → Business profile. */
  @IsOptional()
  @IsBoolean()
  returnsOwnerOnly?: boolean;

  /** Sprint 25 — Maker-checker void/refund threshold in peso-cents.
   *  0 = disabled. Only meaningful when the tenant's plan has
   *  PLAN_FEATURES[planCode].makerCheckerVoids === true. */
  @IsOptional()
  @IsInt()
  @Min(0)
  voidApprovalThresholdCents?: number;

  /** Magnet Books — owner preference. SIMPLE hides the full accounting
   *  surface (journal, COA, statements, AR/AP, periods) and the ledger
   *  shows only money in / money out / profit. JWT-baked, so a change
   *  takes effect on next login. */
  @ApiPropertyOptional({ enum: LEDGER_MODES })
  @IsOptional()
  @IsIn(LEDGER_MODES)
  ledgerMode?: LedgerModeValue;
}
