/**
 * Sprint 22 — DTOs for RecurringBillTemplate. Mirror of recurring-invoice
 * with WHT defaults (rent → WI160 5%, etc.).
 */
import {
  IsArray, IsDateString, IsEnum, IsInt, IsNumber, IsOptional, IsString,
  MaxLength, Min, Max, ValidateNested, ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RecurrenceFrequency } from '@prisma/client';

export class RecurringBillLineDto {
  @ApiProperty() @IsString() accountId: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) description?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional() @IsNumber({ maxDecimalPlaces: 4 }) @Min(0.0001)
  quantity?: number;

  @ApiProperty() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) unitPrice: number;

  @ApiPropertyOptional({ default: 0, description: 'Input VAT on this line' })
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  taxAmount?: number;

  @ApiProperty({ description: '(quantity × unitPrice) + taxAmount' })
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) lineTotal: number;
}

export class CreateRecurringBillDto {
  @ApiProperty() @IsString() @MaxLength(200) name: string;
  @ApiProperty() @IsString() vendorId: string;
  @ApiPropertyOptional() @IsOptional() @IsString() branchId?: string;

  @ApiProperty({ enum: ['WEEKLY', 'MONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'YEARLY'] })
  @IsEnum(['WEEKLY', 'MONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'YEARLY'])
  frequency: RecurrenceFrequency;

  @ApiProperty({ description: '0-6 for WEEKLY, 1-31 for MONTHLY+' })
  @IsInt() @Min(0) @Max(31) dayOfPeriod: number;

  @ApiProperty() @IsDateString() startDate: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() endDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) termsDays?: number;

  @ApiPropertyOptional({ description: 'Default WHT amount per child bill (rent typically WI160 5%).' })
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  whtAmount?: number;

  @ApiPropertyOptional({ description: 'BIR ATC code, e.g. WI160 rentals 5%.' })
  @IsOptional() @IsString() @MaxLength(20)
  whtAtcCode?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) description?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) notes?: string;

  @ApiProperty({ type: () => [RecurringBillLineDto] })
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true })
  @Type(() => RecurringBillLineDto)
  lines: RecurringBillLineDto[];
}

export class UpdateRecurringBillDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() branchId?: string;
  @ApiPropertyOptional() @IsOptional() @IsEnum(['WEEKLY', 'MONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'YEARLY'])
  frequency?: RecurrenceFrequency;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(31) dayOfPeriod?: number;
  @ApiPropertyOptional() @IsOptional() @IsDateString() endDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) termsDays?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) whtAmount?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) whtAtcCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) description?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) notes?: string;

  @ApiPropertyOptional({ type: () => [RecurringBillLineDto] })
  @IsOptional() @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true })
  @Type(() => RecurringBillLineDto)
  lines?: RecurringBillLineDto[];
}
