import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  
  MaxLength,
} from 'class-validator';
import { AccountType, NormalBalance, PostingControl } from '@prisma/client';

export class CreateAccountDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  code: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @IsEnum(AccountType)
  type: AccountType;

  @IsEnum(NormalBalance)
  normalBalance: NormalBalance;

  @IsOptional()
  @IsEnum(PostingControl)
  postingControl?: PostingControl;

  @IsOptional()
  @IsString()
  parentId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}
