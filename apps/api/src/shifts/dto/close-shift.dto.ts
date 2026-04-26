import { IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CloseShiftDto {
  @ApiProperty({ example: 3450.50 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  closingCashDeclared: number;

  @ApiPropertyOptional({ example: 'Busy day, no issues' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
