import { IsString, IsOptional, IsInt, Min, IsEmail } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateCustomerDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  tin?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsEmail()
  contactEmail?: string;

  @IsOptional()
  @IsString()
  contactPhone?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  creditTermDays?: number;

  @IsOptional()
  @Type(() => Number)
  creditLimit?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  /**
   * Special price list for this customer. The Ledger > Customers form always
   * sends this field — `null` means "use default pricing". It was missing
   * here, so the global whitelist pipe rejected every create and every edit
   * with "property priceListId should not exist".
   * (@IsOptional lets both null and undefined through.)
   */
  @IsOptional()
  @IsString()
  priceListId?: string | null;
}
