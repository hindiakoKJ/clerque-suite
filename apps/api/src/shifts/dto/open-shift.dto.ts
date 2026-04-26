import { IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class OpenShiftDto {
  @ApiProperty({ example: 'clxyz456...' })
  @IsString()
  branchId: string;

  @ApiProperty({ example: 1000 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  openingCash: number;

  @ApiPropertyOptional({ example: 'Morning shift' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
