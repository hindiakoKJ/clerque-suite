import { IsBoolean, IsEnum, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

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

  /**
   * The four fields below were written by updateTaxSettings but never declared
   * here. The global pipe runs with forbidNonWhitelisted, so the BIR panel —
   * which posts all of them together — was rejected outright with "property
   * isPtuHolder should not exist", and a registered shop could never save its
   * COR address, PTU or MIN onto its receipts.
   */
  @IsOptional()
  @IsString()
  @MaxLength(300)
  registeredAddress?: string;

  @IsOptional()
  @IsBoolean()
  isPtuHolder?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  ptuNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  minNumber?: string;
}
