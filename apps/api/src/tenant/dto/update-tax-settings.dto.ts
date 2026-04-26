import { IsEnum, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/** Canonical values matching shared-types TaxStatus */
export const TAX_STATUSES = ['VAT', 'NON_VAT', 'UNREGISTERED'] as const;
export const ACCOUNTING_METHODS = ['CASH', 'ACCRUAL'] as const;

export class UpdateTaxSettingsDto {
  @IsOptional()
  @IsEnum(TAX_STATUSES)
  taxStatus?: 'VAT' | 'NON_VAT' | 'UNREGISTERED';

  /**
   * BIR-format TIN: 000-000-000 or 000-000-000-00000 (with branch code).
   */
  @IsOptional()
  @IsString()
  @Matches(/^\d{3}-\d{3}-\d{3}(-\d{3,5})?$/, {
    message: 'tinNumber must be in BIR format: 000-000-000 or 000-000-000-00000',
  })
  tinNumber?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  businessName?: string;

  @IsOptional()
  @IsEnum(ACCOUNTING_METHODS)
  accountingMethod?: 'CASH' | 'ACCRUAL';
}
