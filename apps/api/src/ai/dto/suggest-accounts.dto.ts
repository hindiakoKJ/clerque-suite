import { IsArray, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SuggestAccountsDto {
  @ApiProperty({ description: 'The free-text memo of the entry being drafted.' })
  @IsString()
  @MaxLength(500)
  memo: string;

  @ApiProperty({ enum: ['DEBIT', 'CREDIT'] })
  @IsIn(['DEBIT', 'CREDIT'])
  side: 'DEBIT' | 'CREDIT';

  @ApiPropertyOptional({ description: 'Account ids already used in other lines of this entry.' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  excludeIds?: string[];

  @ApiPropertyOptional({ description: 'Top-N to return as primary suggestions.', default: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  limit?: number;
}
