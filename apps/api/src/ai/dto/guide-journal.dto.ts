import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class GuideLineDto {
  @ApiProperty()
  @IsString()
  accountId: string;

  @ApiProperty({ enum: ['DEBIT', 'CREDIT'] })
  @IsIn(['DEBIT', 'CREDIT'])
  side: 'DEBIT' | 'CREDIT';

  @ApiProperty()
  @IsNumber()
  @Min(0)
  amount: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}

export class GuideJournalDto {
  @ApiProperty({ description: 'ISO date (YYYY-MM-DD).' })
  @IsISO8601()
  date: string;

  @ApiProperty()
  @IsString()
  @MaxLength(500)
  memo: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reference?: string | null;

  @ApiProperty({ type: () => [GuideLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => GuideLineDto)
  lines: GuideLineDto[];
}
