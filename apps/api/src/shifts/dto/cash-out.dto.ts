import { IsEnum, IsNumber, IsOptional, IsString, IsUrl, MaxLength, Min, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCashOutDto {
  @ApiProperty({ enum: ['PAID_OUT', 'CASH_DROP'] })
  @IsEnum(['PAID_OUT', 'CASH_DROP'])
  type: 'PAID_OUT' | 'CASH_DROP';

  @ApiProperty({ example: 250.00, minimum: 0.01 })
  @IsNumber()
  @Min(0.01)
  amount: number;

  @ApiProperty({ example: 'Bought ice for the bar from store next door' })
  @IsString()
  @MinLength(10, { message: 'Reason must be at least 10 characters.' })
  @MaxLength(500)
  reason: string;

  @ApiPropertyOptional({ example: 'supplies' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  category?: string;

  @ApiPropertyOptional({ example: 'https://...' })
  @IsOptional()
  @IsUrl()
  receiptPhotoUrl?: string;

  /** Above-threshold paid-outs require manager PIN co-auth — pass the manager's user id. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  approvedById?: string;

  /** Set true when the form was prefilled by receipt OCR. */
  @ApiPropertyOptional()
  @IsOptional()
  aiAssisted?: boolean;
}
