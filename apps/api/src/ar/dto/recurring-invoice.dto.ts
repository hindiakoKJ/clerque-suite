/**
 * Sprint 22 — DTOs for RecurringInvoiceTemplate.
 */
import {
  IsArray, IsDateString, IsEnum, IsInt, IsNumber, IsOptional, IsString,
  MaxLength, Min, Max, ValidateNested, ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RecurrenceFrequency } from '@prisma/client';

export class RecurringInvoiceLineDto {
  @ApiProperty() @IsString() accountId: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional() @IsNumber({ maxDecimalPlaces: 4 }) @Min(0.0001)
  quantity?: number;

  @ApiProperty() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  unitPrice: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  taxAmount?: number;

  @ApiProperty({ description: '(quantity × unitPrice) + taxAmount' })
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  lineTotal: number;
}

export class CreateRecurringInvoiceDto {
  @ApiProperty({ description: 'Human label, e.g. "Monthly retainer — ACME Corp"' })
  @IsString() @MaxLength(200)
  name: string;

  @ApiProperty() @IsString() customerId: string;

  @ApiPropertyOptional() @IsOptional() @IsString() branchId?: string;

  @ApiProperty({ enum: ['WEEKLY', 'MONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'YEARLY'] })
  @IsEnum(['WEEKLY', 'MONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'YEARLY'])
  frequency: RecurrenceFrequency;

  @ApiProperty({ description: '0-6 (Sun-Sat) for WEEKLY, 1-31 for MONTHLY+' })
  @IsInt() @Min(0) @Max(31)
  dayOfPeriod: number;

  @ApiProperty({ description: 'First invoice date (ISO YYYY-MM-DD)' })
  @IsDateString() startDate: string;

  @ApiPropertyOptional({ description: 'Optional terminal date. Templates auto-COMPLETE when next run would exceed this.' })
  @IsOptional() @IsDateString() endDate?: string;

  @ApiPropertyOptional({ description: 'Net days, copied into each child invoice.' })
  @IsOptional() @IsInt() @Min(0) termsDays?: number;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500)
  description?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000)
  notes?: string;

  @ApiProperty({ type: () => [RecurringInvoiceLineDto] })
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true })
  @Type(() => RecurringInvoiceLineDto)
  lines: RecurringInvoiceLineDto[];
}

export class UpdateRecurringInvoiceDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() branchId?: string;
  @ApiPropertyOptional() @IsOptional() @IsEnum(['WEEKLY', 'MONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'YEARLY'])
  frequency?: RecurrenceFrequency;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(31) dayOfPeriod?: number;
  @ApiPropertyOptional() @IsOptional() @IsDateString() endDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) termsDays?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) description?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) notes?: string;

  @ApiPropertyOptional({ type: () => [RecurringInvoiceLineDto] })
  @IsOptional() @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true })
  @Type(() => RecurringInvoiceLineDto)
  lines?: RecurringInvoiceLineDto[];
}
