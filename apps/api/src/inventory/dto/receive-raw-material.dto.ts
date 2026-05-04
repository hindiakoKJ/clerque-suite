import { IsString, IsNotEmpty, IsNumber, IsPositive, IsOptional, MaxLength, IsDateString, IsIn } from 'class-validator';

export class ReceiveRawMaterialDto {
  @IsString()
  @IsNotEmpty()
  branchId: string;

  /** Quantity to add (always positive) */
  @IsNumber({ maxDecimalPlaces: 4 })
  @IsPositive()
  quantity: number;

  /** Optional cost per unit for this delivery — updates WAC */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  costPrice?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  /**
   * Receipt date (defaults to today). Cashier can backdate to invoice/delivery
   * date. Period-lock is enforced — backdating into a closed period is rejected.
   */
  @IsOptional()
  @IsDateString()
  receivedAt?: string;

  /**
   * How was this delivery paid? Drives the credit side of the journal entry:
   *   - CASH         → Cr 1010 Cash on Hand   (default — most common MSME path)
   *   - CREDIT       → Cr 2010 Accounts Payable (for accrual / Net-30 suppliers)
   *   - OWNER_FUNDED → Cr 3010 Owner's Capital (owner stocked from personal funds)
   */
  @IsOptional()
  @IsIn(['CASH', 'CREDIT', 'OWNER_FUNDED'])
  paymentMethod?: 'CASH' | 'CREDIT' | 'OWNER_FUNDED';

  /** Optional reference (PO number, supplier invoice number, DR number, etc.) */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  referenceNumber?: string;

  /**
   * Vendor (supplier) — required when paymentMethod is CREDIT (a Bill needs
   * a vendor to track AR). Optional for CASH / OWNER_FUNDED.
   */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  vendorId?: string;

  /**
   * Days until the bill is due (Net terms). Defaults to 30 when paymentMethod
   * is CREDIT. Ignored otherwise.
   */
  @IsOptional()
  @IsNumber()
  termsDays?: number;
}
