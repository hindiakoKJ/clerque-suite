import {
  IsArray, IsDateString, IsEnum, IsNumber, IsOptional, IsString,
  MaxLength, Min, ValidateNested, ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { VendorCreditNoteReason } from '@prisma/client';

export class VendorCreditNoteLineDto {
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

export class CreateVendorCreditNoteDto {
  @ApiProperty()
  @IsString()
  vendorId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  branchId?: string;

  @ApiProperty({ description: 'ISO date YYYY-MM-DD' })
  @IsDateString()
  noteDate: string;

  @ApiPropertyOptional({ description: 'Defaults to noteDate.' })
  @IsOptional()
  @IsDateString()
  postingDate?: string;

  @ApiPropertyOptional({ description: "Vendor's own credit-note reference." })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  vendorNoteRef?: string;

  @ApiPropertyOptional({ enum: VendorCreditNoteReason })
  @IsOptional()
  @IsEnum(VendorCreditNoteReason)
  reason?: VendorCreditNoteReason;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reasonNotes?: string;

  @ApiPropertyOptional({ description: 'Informational FK to the source bill.' })
  @IsOptional()
  @IsString()
  relatedBillId?: string;

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

  @ApiProperty({ type: () => [VendorCreditNoteLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => VendorCreditNoteLineDto)
  lines: VendorCreditNoteLineDto[];
}

export class UpdateVendorCreditNoteDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  noteDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  postingDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  vendorNoteRef?: string;

  @ApiPropertyOptional({ enum: VendorCreditNoteReason })
  @IsOptional()
  @IsEnum(VendorCreditNoteReason)
  reason?: VendorCreditNoteReason;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reasonNotes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  relatedBillId?: string;

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

  @ApiPropertyOptional({ type: () => [VendorCreditNoteLineDto] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => VendorCreditNoteLineDto)
  lines?: VendorCreditNoteLineDto[];
}

export class ApplyVendorCreditNoteDto {
  @ApiProperty()
  @IsString()
  billId: string;

  @ApiProperty()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount: number;
}

export class VoidVendorCreditNoteDto {
  @ApiProperty()
  @IsString()
  @MaxLength(500)
  reason: string;
}
