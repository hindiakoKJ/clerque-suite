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

  /** Master switch for ingredient deduction at sale time.
   *  false = PAUSE (sales stop deducting ingredients; COGS is unaffected).
   *  true  = resume. Stored as Tenant.recipeDeductionPausedAt, so the instant
   *  the pause began is preserved for the Recipe Catch-Up. */
  @IsOptional()
  @IsBoolean()
  recipeDeductionEnabled?: boolean;

  /** Let cashiers ring up a product the system believes has no stock.
   *  The POS grid disables an out-of-stock tile; this un-disables it for a
   *  shop still entering its counts. Stock still moves and still hits zero. */
  @IsOptional()
  @IsBoolean()
  allowSaleWhenOutOfStock?: boolean;

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

  /**
   * House costing switch.
   *
   * UNIT_BASED  — cost of sales comes from each product's own Cost Price.
   *               Recipes still deduct ingredients from stock; they just do
   *               not drive the money. This is the right setting while a
   *               shop is still pricing its ingredients.
   * RECIPE_BASED — cost of sales is computed from ingredients x weighted
   *               average cost for everything that has a recipe.
   *
   * A product marked RECIPE_BASED uses its recipe either way, so a shop can
   * move products across one at a time before flipping the house switch.
   */
  @ApiPropertyOptional({ enum: ['UNIT_BASED', 'RECIPE_BASED'] })
  @IsOptional()
  @IsIn(['UNIT_BASED', 'RECIPE_BASED'])
  inventoryMode?: 'UNIT_BASED' | 'RECIPE_BASED';
}
