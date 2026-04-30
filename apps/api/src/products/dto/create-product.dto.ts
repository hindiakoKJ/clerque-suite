import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const INVENTORY_MODES = ['UNIT_BASED', 'RECIPE_BASED'] as const;

export class CreateVariantDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  sku?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  price?: number;
}

export class CreateBomItemDto {
  @IsString()
  rawMaterialId: string;

  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0.0001)
  quantity: number;
}

export class CreateProductDto {
  @ApiProperty({ example: 'Brewed Coffee' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  sku?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  barcode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  categoryId?: string;

  @ApiProperty({ example: 85.00 })
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  price: number;

  /**
   * Unit cost — REQUIRED. Drives COGS posting on every sale, which is
   * required for accurate gross-profit reporting and BIR compliance.
   * Setting this to 0 is allowed (e.g. complimentary items) but the field
   * must be provided explicitly so the operator confirms there's no margin.
   */
  @ApiProperty({ example: 60.00, description: 'Unit cost (₱). Drives COGS — required.' })
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  costPrice: number;

  /**
   * Optional product image. Accepts a public URL (e.g. CDN, supplier site,
   * Google Drive direct link). File-upload backed by cloud storage is on
   * the roadmap; for now the form lets the operator paste a URL.
   */
  @ApiPropertyOptional({ example: 'https://cdn.example.com/iced-latte.jpg' })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  imageUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEnum(INVENTORY_MODES)
  inventoryMode?: 'UNIT_BASED' | 'RECIPE_BASED';

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isVatable?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  unitOfMeasureId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateVariantDto)
  variants?: CreateVariantDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateBomItemDto)
  bomItems?: CreateBomItemDto[];
}
