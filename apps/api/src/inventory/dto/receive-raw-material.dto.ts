import { IsString, IsNotEmpty, IsNumber, IsPositive, IsOptional, MaxLength } from 'class-validator';

export class ReceiveRawMaterialDto {
  @IsString()
  @IsNotEmpty()
  branchId: string;

  /** Quantity to add (always positive) */
  @IsNumber({ maxDecimalPlaces: 4 })
  @IsPositive()
  quantity: number;

  /** Optional cost per unit for this delivery — updates WAC */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  costPrice?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
