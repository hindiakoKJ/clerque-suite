import { IsOptional, IsString, Matches, MaxLength, ValidateIf } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { LOGO_LINK_MAX_LENGTH, LOGO_LINK_PATTERN } from '../logo-link';

export const LOGO_LINK_MESSAGE =
  'The logo must be a link starting with https:// or an uploaded logo. Use Upload logo in Settings to add a picture.';

/**
 * PATCH /tenant/receipt-config.
 *
 * This body used to be a plain inline type, so the global ValidationPipe
 * checked nothing: any string up to the 10 MB JSON limit, data: images
 * included, went straight into the column and then into the login token.
 * null or "" clears a field.
 */
export class UpdateReceiptConfigDto {
  @ApiPropertyOptional({ maxLength: 200, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  headerNote?: string | null;

  @ApiPropertyOptional({ maxLength: 300, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  footerNote?: string | null;

  @ApiPropertyOptional({ maxLength: LOGO_LINK_MAX_LENGTH, nullable: true })
  @ValidateIf((o) => o.logoUrl != null && String(o.logoUrl).trim() !== '')
  @IsString()
  @MaxLength(LOGO_LINK_MAX_LENGTH, { message: 'The logo link is too long.' })
  @Matches(LOGO_LINK_PATTERN, { message: LOGO_LINK_MESSAGE })
  logoUrl?: string | null;
}
