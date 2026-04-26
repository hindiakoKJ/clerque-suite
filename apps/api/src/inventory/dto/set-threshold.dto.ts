import { IsNumber, IsString, Min, ValidateIf } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class SetThresholdDto {
  @ApiProperty({ example: 'clxyz123...' })
  @IsString()
  productId: string;

  @ApiProperty({ example: 'clxyz456...' })
  @IsString()
  branchId: string;

  /**
   * Set to `null` to clear the threshold.
   * When a number, must be ≥ 0.
   */
  @ApiProperty({ example: 5, nullable: true, description: 'null to clear threshold' })
  @Transform(({ value }) => (value === '' || value === undefined ? null : Number(value)))
  @ValidateIf((o: SetThresholdDto) => o.lowStockAlert !== null)
  @IsNumber({ maxDecimalPlaces: 0 })
  @Min(0)
  lowStockAlert: number | null;
}
