import {
  IsDateString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class ConfirmSettlementDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  actualAmount: number;

  /** ISO date string — when the bank credit arrived */
  @IsDateString()
  settledAt: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  bankReference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
