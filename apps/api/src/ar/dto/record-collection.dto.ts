import { IsNumber, IsString, IsOptional, IsPositive, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';

export class RecordCollectionDto {
  @IsNumber()
  @IsPositive()
  @Type(() => Number)
  amount!: number;

  @IsString()
  paymentMethod!: string;

  @IsOptional()
  @IsString()
  reference?: string;

  @IsOptional()
  @IsDateString()
  collectedAt?: string;
}
