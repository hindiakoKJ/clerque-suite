import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
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
   * Pass the UUID to assign a branch, or explicitly pass `null` to unassign.
   * class-transformer converts the empty string to null.
   */
  @ApiPropertyOptional({ example: 'clxyz123...', nullable: true })
  @IsOptional()
  @Transform(({ value }) => (value === '' ? null : value))
  @IsUUID('all', { message: 'branchId must be a valid UUID or null.' })
  branchId?: string | null;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

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
