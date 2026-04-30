import {
  IsArray, IsDateString, IsInt, IsNumber, IsOptional, IsString,
  MaxLength, Min, ValidateNested, ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class APBillLineDto {
  @ApiProperty()
  @IsString()
  accountId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0.0001)
  quantity?: number;

  @ApiProperty()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  unitPrice: number;

  @ApiPropertyOptional({ default: 0, description: 'Input VAT on this line' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  taxAmount?: number;

  @ApiProperty({ description: '(quantity × unitPrice) + taxAmount' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  lineTotal: number;
}

export class CreateAPBillDto {
  @ApiProperty()
  @IsString()
  vendorId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  branchId?: string;

  @ApiProperty({ description: 'ISO date YYYY-MM-DD — bill issue date.' })
  @IsDateString()
  billDate: string;

  @ApiPropertyOptional({ description: 'Defaults to billDate.' })
  @IsOptional()
  @IsDateString()
  postingDate?: string;

  @ApiPropertyOptional({ description: 'Net days. Defaults to 30.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  termsDays?: number;

  @ApiPropertyOptional({ description: "Vendor's own invoice number / SI#." })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  vendorBillRef?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reference?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiPropertyOptional({ description: 'Withholding tax amount (PH 2307 EWT/CWT).' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  whtAmount?: number;

  @ApiPropertyOptional({ description: 'BIR ATC code, e.g. WI160 rentals 5%.' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  whtAtcCode?: string;

  @ApiProperty({ type: () => [APBillLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => APBillLineDto)
  lines: APBillLineDto[];
}
