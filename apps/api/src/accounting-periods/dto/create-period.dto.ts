import {
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreatePeriodDto {
  /** Human-readable label, e.g. "April 2026" */
  @ApiProperty({ example: 'April 2026' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  /** ISO date string: YYYY-MM-DD */
  @ApiProperty({ example: '2026-04-01' })
  @IsDateString()
  startDate: string;

  /** ISO date string: YYYY-MM-DD — must be ≥ startDate (validated in service) */
  @ApiProperty({ example: '2026-04-30' })
  @IsDateString()
  endDate: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
