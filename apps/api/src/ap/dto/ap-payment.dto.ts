import {
  IsArray, IsDateString, IsEnum, IsNumber, IsOptional, IsString, MaxLength, Min, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const PAYMENT_METHODS = ['CASH', 'GCASH_PERSONAL', 'GCASH_BUSINESS', 'MAYA_PERSONAL', 'MAYA_BUSINESS', 'QR_PH'] as const;
type PaymentMethodLiteral = typeof PAYMENT_METHODS[number];

export class APPaymentApplicationDto {
  @ApiProperty()
  @IsString()
  billId: string;

  @ApiProperty()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  appliedAmount: number;
}

export class CreateAPPaymentDto {
  @ApiProperty()
  @IsString()
  vendorId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  branchId?: string;

  @ApiProperty({ description: 'ISO date YYYY-MM-DD' })
  @IsDateString()
  paymentDate: string;

  @ApiPropertyOptional({ description: 'Defaults to paymentDate.' })
  @IsOptional()
  @IsDateString()
  postingDate?: string;

  @ApiProperty({ enum: PAYMENT_METHODS })
  @IsEnum(PAYMENT_METHODS)
  method: PaymentMethodLiteral;

  @ApiPropertyOptional({ description: 'Check#, GCash ref, etc.' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  reference?: string;

  @ApiProperty({ description: 'Cash actually paid (already net of WHT).' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  totalAmount: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ type: () => [APPaymentApplicationDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => APPaymentApplicationDto)
  applications?: APPaymentApplicationDto[];
}

export class ApplyAPPaymentDto {
  @ApiProperty({ type: () => [APPaymentApplicationDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => APPaymentApplicationDto)
  applications: APPaymentApplicationDto[];
}
