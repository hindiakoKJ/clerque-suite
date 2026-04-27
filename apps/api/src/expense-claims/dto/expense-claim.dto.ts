import {
  IsString,
  IsOptional,
  IsNumber,
  IsDateString,
  IsArray,
  ValidateNested,
  IsEnum,
  Min,
  IsPositive,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateExpenseClaimItemDto {
  @ApiProperty({ example: 'Meals' })
  @IsString()
  category: string; // "Meals" | "Transport" | "Accommodation" | "Supplies" | "Communication" | "Other"

  @ApiProperty({ example: 'Team lunch after client meeting' })
  @IsString()
  description: string;

  @ApiProperty({ example: 450.0 })
  @IsNumber()
  @IsPositive()
  amount: number;

  @ApiProperty({ example: '2026-04-15' })
  @IsDateString()
  receiptDate: string;

  @ApiPropertyOptional({ example: 'OR-001234' })
  @IsOptional()
  @IsString()
  receiptRef?: string;
}

export class CreateExpenseClaimDto {
  @ApiProperty({ example: 'April Sales Trip — Cebu' })
  @IsString()
  title: string;

  @ApiPropertyOptional({ example: 'Travel expenses for the Cebu client visit' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ type: [CreateExpenseClaimItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateExpenseClaimItemDto)
  items: CreateExpenseClaimItemDto[];
}

export class ReviewExpenseClaimDto {
  @ApiProperty({ enum: ['APPROVE', 'REJECT'] })
  @IsEnum(['APPROVE', 'REJECT'])
  action: 'APPROVE' | 'REJECT';

  @ApiPropertyOptional({ example: 'All receipts verified.' })
  @IsOptional()
  @IsString()
  reviewNotes?: string;
}

export class MarkPaidDto {
  @ApiPropertyOptional({ example: 'TXN-20260427-001' })
  @IsOptional()
  @IsString()
  paymentRef?: string;
}
