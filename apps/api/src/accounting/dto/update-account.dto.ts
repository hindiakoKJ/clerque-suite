import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  
  MaxLength,
} from 'class-validator';
import { PostingControl } from '@prisma/client';

export class UpdateAccountDto {
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
  parentId?: string;

  @IsOptional()
  @IsEnum(PostingControl)
  postingControl?: PostingControl;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
