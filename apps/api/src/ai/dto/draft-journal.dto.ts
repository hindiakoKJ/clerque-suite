import { IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class DraftJournalDto {
  @ApiProperty({
    description: 'Free-text transaction description, e.g. "Paid Meralco bill ₱8,500 last Tuesday from BPI checking".',
    minLength: 5,
    maxLength: 1000,
  })
  @IsString()
  @MinLength(5)
  @MaxLength(1000)
  description: string;
}
