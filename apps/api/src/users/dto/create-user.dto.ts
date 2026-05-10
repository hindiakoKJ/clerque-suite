import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,

  MaxLength,
  MinLength,
  Matches,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const STAFF_ROLES = [
  'BUSINESS_OWNER',
  'MDM',
  'BRANCH_MANAGER',
  'SALES_LEAD',
  'ACCOUNTANT',
  'BOOKKEEPER',
  'FINANCE_LEAD',
  'PAYROLL_MASTER',
  'WAREHOUSE_STAFF',
  'CASHIER',
  'GENERAL_EMPLOYEE',
  'EXTERNAL_AUDITOR',
  // Service / Display Accounts — kiosk credentials, not real employees.
  // No Payroll, no Ledger, no Terminal. Excluded from staff cap.
  'KIOSK_DISPLAY',
] as const;

export type StaffRole = (typeof STAFF_ROLES)[number];

export class CreateUserDto {
  @ApiProperty({ example: 'Maria Santos' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @ApiProperty({ example: 'maria@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'SecurePass123!', minLength: 8, required: false })
  @ValidateIf((o) => !o.kioskOnly)
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password: string;

  @ApiProperty({ enum: STAFF_ROLES, example: 'CASHIER' })
  @IsEnum(STAFF_ROLES)
  role: StaffRole;

  @ApiPropertyOptional({ example: 'clxyz123...' })
  @IsOptional()
  @IsString()
  branchId?: string;

  /** 4–8 digit numeric PIN for kiosk mode */
  @ApiPropertyOptional({ example: '1234', description: '4–8 digit numeric PIN' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4,8}$/, { message: 'kioskPin must be 4–8 digits.' })
  kioskPin?: string;

  /**
   * Sprint 19 — Kiosk-only employees clock in/out at the shared tablet
   * but never log into Sync via password. Owners onboard cooks /
   * dishwashers / drivers without inventing credentials. When true,
   * password is not required and a synthetic hash is stored server-side.
   * kioskPin is required.
   */
  @ApiPropertyOptional({ example: false, description: 'Clock-only employee — no Sync login' })
  @IsOptional()
  @IsBoolean()
  kioskOnly?: boolean;
}
