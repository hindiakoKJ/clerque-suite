import {
  IsArray, IsDateString, IsInt, IsNumber, IsOptional, IsString,
  MaxLength, Min, ValidateNested, ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ARInvoiceLineDto {
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

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  taxAmount?: number;

  @ApiProperty({ description: '(quantity × unitPrice) + taxAmount' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  lineTotal: number;
}

export class CreateARInvoiceDto {
  @ApiProperty()
  @IsString()
  customerId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  branchId?: string;

  @ApiProperty({ description: 'ISO date YYYY-MM-DD' })
  @IsDateString()
  invoiceDate: string;

  @ApiPropertyOptional({ description: 'Defaults to invoiceDate.' })
  @IsOptional()
  @IsDateString()
  postingDate?: string;

  @ApiPropertyOptional({ description: 'Net days. Defaults to customer.creditTermDays.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  termsDays?: number;

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

  @ApiProperty({ type: () => [ARInvoiceLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ARInvoiceLineDto)
  lines: ARInvoiceLineDto[];
}
