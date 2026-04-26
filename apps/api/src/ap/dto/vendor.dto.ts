import {
  IsString, IsOptional, IsBoolean,
  IsEmail, IsDecimal, MaxLength,
} from 'class-validator';

export class CreateVendorDto {
  @IsString()
  @MaxLength(200)
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
  @IsString()
  defaultAtcCode?: string;

  @IsOptional()
  @IsDecimal({ decimal_digits: '0,4' })
  defaultWhtRate?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateVendorDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

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
  @IsString()
  defaultAtcCode?: string;

  @IsOptional()
  @IsDecimal({ decimal_digits: '0,4' })
  defaultWhtRate?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  notes?: string;
}
