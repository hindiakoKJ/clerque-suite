import { IsBase64, IsIn, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class OcrReceiptDto {
  @ApiProperty({ description: 'Base64-encoded image (no data: prefix)' })
  @IsString()
  @IsBase64()
  imageBase64: string;

  @ApiPropertyOptional({ enum: ['image/jpeg', 'image/png', 'image/webp'] })
  @IsOptional()
  @IsIn(['image/jpeg', 'image/png', 'image/webp'])
  mediaType?: 'image/jpeg' | 'image/png' | 'image/webp';
}

export interface OcrReceiptResult {
  amount:     number | null;
  vendor:     string | null;
  dateText:   string | null;
  category:   string;
  reasonHint: string;
  confidence: {
    amount:   number;
    vendor:   number;
    date:     number;
    category: number;
  };
}
