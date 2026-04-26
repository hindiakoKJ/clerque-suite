import { IsNotEmpty, IsString, MinLength, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ReopenPeriodDto {
  /**
   * Business justification for reopening.
   * Minimum 10 characters to prevent single-word reasons ("mistake", "oops").
   */
  @ApiProperty({ example: 'Correction needed for April payroll entry', minLength: 10 })
  @IsString()
  @IsNotEmpty()
  @MinLength(10, { message: 'Reopen reason must be at least 10 characters.' })
  @MaxLength(500)
  reason: string;
}
