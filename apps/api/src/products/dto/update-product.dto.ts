import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { INVENTORY_MODES } from './create-product.dto';

export class UpdateProductDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  sku?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  barcode?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  price?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  costPrice?: number;

  @IsOptional()
  @IsBoolean()
  isVatable?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  unitOfMeasureId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  imageUrl?: string;

  /**
   * Toggle between UNIT_BASED (finished-goods inventory) and RECIPE_BASED
   * (BOM-driven, derives stock from raw materials). Updating this on an
   * existing product is allowed when the product's BOM is empty (UNIT_BASED)
   * or has BOM entries (RECIPE_BASED) — the products.service handles the
   * sync between this flag and bomItems independently.
   */
  @IsOptional()
  @IsEnum(INVENTORY_MODES)
  inventoryMode?: 'UNIT_BASED' | 'RECIPE_BASED';
}
