import { IsEmail, IsString, IsOptional, MinLength } from 'class-validator';

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
