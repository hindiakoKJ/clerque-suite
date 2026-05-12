import {
  IsArray, IsDateString, IsEnum, IsNumber, IsOptional, IsString,
  MaxLength, Min, ValidateNested, ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CreditMemoReason } from '@prisma/client';

export class CreditMemoLineDto {
  @ApiProperty()
  @IsString()
  accountId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0.0001)
  quantity?: number;

  @ApiProperty()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  unitPrice: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  taxAmount?: number;

  @ApiProperty({ description: '(quantity × unitPrice) + taxAmount' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  lineTotal: number;
}

export class CreateCreditMemoDto {
  @ApiProperty()
  @IsString()
  customerId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  branchId?: string;

  @ApiProperty({ description: 'ISO date YYYY-MM-DD' })
  @IsDateString()
  memoDate: string;

  @ApiPropertyOptional({ description: 'Defaults to memoDate.' })
  @IsOptional()
  @IsDateString()
  postingDate?: string;

  @ApiPropertyOptional({ enum: CreditMemoReason })
  @IsOptional()
  @IsEnum(CreditMemoReason)
  reason?: CreditMemoReason;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reasonNotes?: string;

  @ApiPropertyOptional({ description: 'Informational FK to the source invoice.' })
  @IsOptional()
  @IsString()
  relatedInvoiceId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiProperty({ type: () => [CreditMemoLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreditMemoLineDto)
  lines: CreditMemoLineDto[];
}

export class UpdateCreditMemoDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  memoDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  postingDate?: string;

  @ApiPropertyOptional({ enum: CreditMemoReason })
  @IsOptional()
  @IsEnum(CreditMemoReason)
  reason?: CreditMemoReason;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reasonNotes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  relatedInvoiceId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiPropertyOptional({ type: () => [CreditMemoLineDto] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreditMemoLineDto)
  lines?: CreditMemoLineDto[];
}

export class ApplyCreditMemoDto {
  @ApiProperty()
  @IsString()
  invoiceId: string;

  @ApiProperty()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount: number;
}

export class VoidCreditMemoDto {
  @ApiProperty()
  @IsString()
  @MaxLength(500)
  reason: string;
}
