import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { STAFF_ROLES, StaffRole } from './create-user.dto';

export class UpdateUserDto {
  @ApiPropertyOptional({ example: 'Maria Santos' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ enum: ['BUSINESS_OWNER', 'MDM', 'BRANCH_MANAGER', 'ACCOUNTANT', 'CASHIER', 'GENERAL_EMPLOYEE'] })
  @IsOptional()
  @IsEnum(STAFF_ROLES)
  role?: StaffRole;

  /**
   * Pass the branch ID (CUID) to assign a branch, or explicitly pass `null`
   * to unassign. class-transformer converts the empty string to null.
   *
   * NOTE: Branch.id uses Prisma `@default(cuid())`, not UUID. We previously
   * validated with @IsUUID('all') which rejected every legitimate CUID and
   * blocked Save on the staff edit modal. Use @IsString + length bounds.
   */
  @ApiPropertyOptional({ example: 'clxyz123abcdef0123456789', nullable: true })
  @IsOptional()
  @Transform(({ value }) => (value === '' ? null : value))
  @ValidateIf((_, value) => value !== null)
  @IsString({ message: 'branchId must be a string or null.' })
  @MaxLength(64)
  branchId?: string | null;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  /**
   * Sprint 19 — Toggle clock-only mode on an existing account. Going
   * kiosk-only doesn't clear the password (so support can re-enable
   * login if needed) — it just gates /auth/login from this user.
   */
  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  kioskOnly?: boolean;

  /** Pass null to clear the kiosk PIN. */
  @ApiPropertyOptional({ example: '1234', nullable: true })
  @IsOptional()
  @Transform(({ value }) => (value === '' ? null : value))
  @IsString()
  @Matches(/^\d{4,8}$/, { message: 'kioskPin must be 4–8 digits.' })
  kioskPin?: string | null;

  /** RBAC: persona template applied at create / last-edit (e.g., CASHIER_COOK). */
  @ApiPropertyOptional({ example: 'CASHIER_COOK', nullable: true })
  @IsOptional()
  @Transform(({ value }) => (value === '' ? null : value))
  @IsString()
  @MaxLength(64)
  personaKey?: string | null;

  /** RBAC: extra permission grants beyond role + persona defaults (PermissionKey strings). */
  @ApiPropertyOptional({ example: ['inventory:adjust'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  customPermissions?: string[];

  /** RBAC: SOD warning overrides accepted by the owner (free-form JSON). */
  @ApiPropertyOptional()
  @IsOptional()
  sodOverrides?: unknown;
}
