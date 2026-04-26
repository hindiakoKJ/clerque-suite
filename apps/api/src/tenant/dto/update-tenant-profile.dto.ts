import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Matches,
} from 'class-validator';

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
}
