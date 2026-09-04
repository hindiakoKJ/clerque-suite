import { HIREABLE_ROLES, type HireableRole } from '@repo/shared-types';
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

/**
 * Re-exported, not re-listed.
 *
 * This used to be its own hand-maintained array and had drifted from the
 * database: AR_ACCOUNTANT and AP_ACCOUNTANT are real roles, granted
 * `ledger:view` and named in 107 @Roles decorators, but were missing here --
 * so `POST /users` rejected them and no shop could ever hire an AR or AP
 * clerk. One list, in @repo/shared-types, is the fix.
 */
export const STAFF_ROLES = HIREABLE_ROLES;

export type StaffRole = HireableRole;

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
