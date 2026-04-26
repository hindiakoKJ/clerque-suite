import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const STOCK_ADJUST_TYPES = ['INITIAL', 'STOCK_IN', 'STOCK_OUT', 'ADJUSTMENT'] as const;
export type StockAdjustType = (typeof STOCK_ADJUST_TYPES)[number];

export class AdjustStockDto {
  @ApiProperty({ example: 'clxyz123...' })
  @IsString()
  productId: string;

  @ApiProperty({ example: 'clxyz456...' })
  @IsString()
  branchId: string;

  /** Positive = add stock; negative = remove stock. */
  @ApiProperty({ example: 10, description: 'Positive = add, negative = remove' })
  @IsNumber({ maxDecimalPlaces: 4 })
  @IsNotEmpty()
  quantity: number;

  @ApiProperty({ enum: ['INITIAL', 'STOCK_IN', 'STOCK_OUT', 'ADJUSTMENT'], example: 'STOCK_IN' })
  @IsEnum(STOCK_ADJUST_TYPES)
  type: StockAdjustType;

  @ApiPropertyOptional({ example: 'Supplier delivery' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;

  @ApiPropertyOptional({ example: 'DR #12345' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
