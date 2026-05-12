import {
  IsDateString, IsEnum, IsNumber, IsOptional, IsString, MaxLength, Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const PAYMENT_METHODS = ['CASH', 'GCASH_PERSONAL', 'GCASH_BUSINESS', 'MAYA_PERSONAL', 'MAYA_BUSINESS', 'QR_PH'] as const;
type PaymentMethodLiteral = typeof PAYMENT_METHODS[number];

export class CreateVendorAdvanceDto {
  @ApiProperty()
  @IsString()
  vendorId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  branchId?: string;

  @ApiProperty({ description: 'ISO date YYYY-MM-DD — when cash was disbursed' })
  @IsDateString()
  advanceDate!: string;

  @ApiPropertyOptional({ description: 'Defaults to advanceDate.' })
  @IsOptional()
  @IsDateString()
  postingDate?: string;

  @ApiProperty({ enum: PAYMENT_METHODS })
  @IsEnum(PAYMENT_METHODS)
  method!: PaymentMethodLiteral;

  @ApiPropertyOptional({ description: 'Check#, GCash ref, etc.' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  reference?: string;

  @ApiProperty({ description: 'Total prepayment/advance amount in PHP.' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  totalAmount!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class ApplyVendorAdvanceDto {
  @ApiProperty()
  @IsString()
  billId!: string;

  @ApiProperty()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount!: number;
}

export class RefundVendorAdvanceDto {
  @ApiProperty({ enum: PAYMENT_METHODS })
  @IsEnum(PAYMENT_METHODS)
  method!: PaymentMethodLiteral;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  reference?: string;
}

export class VoidVendorAdvanceDto {
  @ApiProperty()
  @IsString()
  @MaxLength(500)
  reason!: string;
}
