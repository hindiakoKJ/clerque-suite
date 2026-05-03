import { IsBoolean, IsIn, IsOptional, IsString, MaxLength, MinLength, IsUUID } from 'class-validator';

const COFFEE_SHOP_TIERS = ['CS_1', 'CS_2', 'CS_3', 'CS_4', 'CS_5'] as const;
type CoffeeShopTierLiteral = (typeof COFFEE_SHOP_TIERS)[number];

export class ApplyTierDto {
  @IsString()
  @IsIn(COFFEE_SHOP_TIERS as unknown as string[])
  tier: CoffeeShopTierLiteral;

  /**
   * CS_1 only — opt in to a customer-facing display even though the canonical
   * CS_1 setup doesn't include one. Ignored for higher tiers.
   */
  @IsOptional()
  @IsBoolean()
  customerDisplayOverride?: boolean;
}

export class RenameStationDto {
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name: string;
}

export class SetCategoryStationDto {
  @IsOptional()
  // CUIDs are not UUIDs; allow generic string. Length capped to keep DB safe.
  @IsString()
  @MaxLength(40)
  stationId: string | null;
}

export class SetCustomerDisplayDto {
  @IsBoolean()
  enabled: boolean;
}
