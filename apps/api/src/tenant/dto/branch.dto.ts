import { IsBoolean, IsOptional, IsString, Matches } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * A branch closing time: "HH:mm", 24-hour, 00:00 to 23:59, always two digits
 * each side. Exactly what a browser's time input gives, and one fixed shape
 * so the job that sends the day's ingredient report at closing can read it
 * without guessing ("9:00", "9pm" and "21:00:00" are all refused).
 */
export const BRANCH_CLOSES_AT_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

const CLOSES_AT_MESSAGE =
  'closesAt must be a 24-hour time like "21:00" (00:00 to 23:59), or null to clear it.';

/*
 * These were plain inline body types before, which the global ValidationPipe
 * does not check at all. As classes they are checked, and forbidNonWhitelisted
 * rejects any field without a decorator -- so every field the Branches page
 * already sends is listed here, not just the new one.
 *
 * name stays optional at this layer on purpose: the controller and service
 * give the friendlier "at least 2 characters" message when it is missing.
 */

export class CreateBranchDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  address?: string | null;

  /** Usual closing time, Manila wall-clock. Omit or null = not set. */
  @ApiPropertyOptional({ example: '21:00', nullable: true, description: 'HH:mm, 24-hour, Manila time' })
  @IsOptional()
  @IsString()
  @Matches(BRANCH_CLOSES_AT_PATTERN, { message: CLOSES_AT_MESSAGE })
  closesAt?: string | null;
}

export class UpdateBranchDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  address?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  /** Usual closing time, Manila wall-clock. Omit = leave as is; null = clear. */
  @ApiPropertyOptional({ example: '21:00', nullable: true, description: 'HH:mm, 24-hour, Manila time; null clears it' })
  @IsOptional()
  @IsString()
  @Matches(BRANCH_CLOSES_AT_PATTERN, { message: CLOSES_AT_MESSAGE })
  closesAt?: string | null;
}
