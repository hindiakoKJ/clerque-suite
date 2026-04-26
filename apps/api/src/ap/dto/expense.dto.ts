import {
  IsString, IsOptional, IsDateString, IsDecimal,
} from 'class-validator';

export class CreateExpenseDto {
  @IsOptional()
  @IsString()
  vendorId?: string;

  @IsOptional()
  @IsString()
  branchId?: string;

  @IsString()
  description!: string;

  @IsDateString()
  expenseDate!: string;

  @IsDecimal({ decimal_digits: '0,4' })
  grossAmount!: string;

  @IsOptional()
  @IsString()
  atcCode?: string;

  @IsOptional()
  @IsDecimal({ decimal_digits: '0,4' })
  whtRate?: string;

  @IsDecimal({ decimal_digits: '0,4' })
  inputVat!: string;

  @IsOptional()
  @IsString()
  referenceNumber?: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateExpenseDto {
  @IsOptional()
  @IsString()
  vendorId?: string;

  @IsOptional()
  @IsString()
  branchId?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsDateString()
  expenseDate?: string;

  @IsOptional()
  @IsDecimal({ decimal_digits: '0,4' })
  grossAmount?: string;

  @IsOptional()
  @IsString()
  atcCode?: string;

  @IsOptional()
  @IsDecimal({ decimal_digits: '0,4' })
  whtRate?: string;

  @IsOptional()
  @IsDecimal({ decimal_digits: '0,4' })
  inputVat?: string;

  @IsOptional()
  @IsString()
  referenceNumber?: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class RecordPaymentDto {
  @IsDecimal({ decimal_digits: '0,4' })
  paidAmount!: string;

  @IsString()
  paymentRef!: string;

  @IsOptional()
  @IsDateString()
  paidAt?: string;
}
