import { IsString, IsNotEmpty, IsOptional, IsNumber, Min, MaxLength } from 'class-validator';

export class CreateRawMaterialDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  /** Unit of measure label: g, ml, kg, pc, oz, tsp, tbsp, cup, etc. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  unit: string;

  /** Cost per unit (in ₱). Used for WAC COGS calculation. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  costPrice?: number;
}
