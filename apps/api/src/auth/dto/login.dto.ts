import { IsEmail, IsString, IsOptional, MinLength, Matches } from 'class-validator';

export class LoginDto {
  @IsOptional()
  @IsString()
  companyCode?: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;
}

export class RefreshDto {
  @IsString()
  refreshToken: string;
}

export class LogoutDto {
  @IsString()
  refreshToken: string;
}

/**
 * Cashier fast-login by 4-8 digit PIN. companyCode is required so the lookup
 * is tenant-scoped (multiple tenants can have a "manager@cafe.ph" email).
 */
export class PinLoginDto {
  @IsString()
  companyCode: string;

  @IsEmail()
  email: string;

  @Matches(/^\d{4,8}$/, { message: 'PIN must be 4–8 digits.' })
  pin: string;
}
