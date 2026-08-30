import { IsString, IsNotEmpty, IsNumber, IsPositive, IsOptional, MaxLength, IsDateString, IsIn, IsBoolean } from 'class-validator';

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
   * "The price really did change."
   *
   * Receiving blends the delivery cost into the weighted average and ripples
   * it out to every recipe using the ingredient, so a cost an order of
   * magnitude away from the one on file is refused — it is nearly always a
   * unit mix-up or a misplaced decimal, and it would silently rewrite every
   * margin in the shop. This is the way past it when the price genuinely moved.
   */
  @IsOptional()
  @IsBoolean()
  acceptCostChange?: boolean;

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

  /**
   * Sprint 25 — Expiration date for this lot (FEFO support). When set on a
   * `lotsTracked` ingredient, the BOM walk drains this lot before others with
   * later expiry. Required in practice for perishables (milk, syrups, beans).
   */
  @IsOptional()
  @IsDateString()
  expirationDate?: string;

  /**
   * Sprint 25 — When this receipt is from a Purchase Order, the receiver UI
   * passes the PO line id so the lot is back-linked for variance reports.
   */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  purchaseOrderItemId?: string;
}
