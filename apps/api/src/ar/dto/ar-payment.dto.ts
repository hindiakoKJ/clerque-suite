import {
  IsArray, IsDateString, IsEnum, IsNumber, IsOptional, IsString, MaxLength, Min, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const PAYMENT_METHODS = ['CASH', 'GCASH_PERSONAL', 'GCASH_BUSINESS', 'MAYA_PERSONAL', 'MAYA_BUSINESS', 'QR_PH'] as const;
type PaymentMethodLiteral = typeof PAYMENT_METHODS[number];

export class ARPaymentApplicationDto {
  @ApiProperty()
  @IsString()
  invoiceId: string;

  @ApiProperty()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  appliedAmount: number;
}

export class CreateARPaymentDto {
  @ApiProperty()
  @IsString()
  customerId: string;

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

  @ApiPropertyOptional({ description: 'OR#, check#, GCash ref' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  reference?: string;

  @ApiProperty()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  totalAmount: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ type: () => [ARPaymentApplicationDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ARPaymentApplicationDto)
  applications?: ARPaymentApplicationDto[];
}

export class ApplyARPaymentDto {
  @ApiProperty({ type: () => [ARPaymentApplicationDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ARPaymentApplicationDto)
  applications: ARPaymentApplicationDto[];
}
