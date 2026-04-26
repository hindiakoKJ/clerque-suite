import { IsString, IsOptional, IsInt, IsDecimal, IsBoolean, Min, IsEmail } from 'class-validator';
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
}
