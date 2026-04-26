import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  
  MaxLength,
  MinLength,
  Matches,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const STAFF_ROLES = [
  'BUSINESS_OWNER',
  'MDM',
  'BRANCH_MANAGER',
  'ACCOUNTANT',
  'CASHIER',
  'GENERAL_EMPLOYEE',
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

  @ApiProperty({ example: 'SecurePass123!', minLength: 8 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password: string;

  @ApiProperty({ enum: ['BUSINESS_OWNER', 'MDM', 'BRANCH_MANAGER', 'ACCOUNTANT', 'CASHIER', 'GENERAL_EMPLOYEE'], example: 'CASHIER' })
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
}
