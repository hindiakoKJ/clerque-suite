import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  
  MaxLength,
} from 'class-validator';
import { PaymentMethod } from '@prisma/client';

export class CreateSettlementBatchDto {
  @IsString()
  branchId: string;

  @IsEnum(PaymentMethod)
  method: PaymentMethod;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  referenceNumber?: string;

  /** ISO date string: start of the settlement period */
  @IsDateString()
  periodStart: string;

  /** ISO date string: end of the settlement period */
  @IsDateString()
  periodEnd: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
