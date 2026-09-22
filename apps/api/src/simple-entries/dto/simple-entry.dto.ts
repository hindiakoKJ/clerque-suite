import {
  IsIn, IsNumber, Min, IsString, IsOptional, MaxLength, IsDateString,
} from 'class-validator';

/**
 * "Simple Entry" — plain-language operational bookkeeping for the SIMPLE tier
 * (Solo Books). Each type maps to a fixed, balanced 2-line journal entry that
 * is posted to the real books via JournalService. The user never sees debits
 * or credits.
 */
export const SIMPLE_ENTRY_TYPES = [
  'EXPENSE',            // money out for an operating cost
  'OTHER_INCOME',       // money in that is NOT a POS sale
  'OWNER_CONTRIBUTION', // owner puts money into the business
  'OWNER_DRAWING',      // owner takes money out for personal use
  'DEPOSIT_TO_BANK',    // move till cash to the bank
  'WITHDRAW_TO_CASH',   // move bank money to the till
  /*
    Goods paid for before they are here -- a Shopee order, a deposit to a
    supplier. The money leaves the pocket now and waits in 1063 Advance
    Deposits (a clearing account, like a GR/IR) until the goods arrive and
    take it onto the shelf; a refund brings it back to the pocket; a parcel
    that never comes is written off.
  */
  'PAID_AHEAD',           // Dr 1063 / Cr pocket
  'PAID_AHEAD_REFUND',    // Dr pocket / Cr 1063
  'PAID_AHEAD_WRITE_OFF', // Dr 6140 / Cr 1063
  /*
    Something the shop will use for years -- an espresso machine, a fridge, a
    grinder. It is an ASSET, not this month's expense: Dr 1075 Machinery &
    Equipment / Cr where the money came from. `assetName` says what was bought.
  */
  'EQUIPMENT_PURCHASE',   // Dr 1075 / Cr paid-from
  /*
    Wages handed to staff outside the Payroll app (a small shop paying its
    barista in cash on Saturday): Dr 6010 Salaries and Wages / Cr paid-from.
  */
  'WAGES_PAID',           // Dr 6010 / Cr paid-from
] as const;
export type SimpleEntryType = (typeof SIMPLE_ENTRY_TYPES)[number];

export const EXPENSE_CATEGORIES = [
  'RENT', 'UTILITIES', 'SUPPLIES', 'REPAIRS', 'TRANSPORT', 'FREIGHT', 'OTHER',
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

/**
 * Where the money came from, for EQUIPMENT_PURCHASE and WAGES_PAID.
 *   CASH  -> 1010 Cash on Hand
 *   BANK  -> 1020 Cash in Bank
 *   OWNER -> 3010 Owner's Capital (the owner paid out of her own pocket; the
 *            shop's cash did not move, her stake in the business went up)
 */
export const PAID_FROM = ['CASH', 'BANK', 'OWNER'] as const;
export type PaidFrom = (typeof PAID_FROM)[number];

export class CreateSimpleEntryDto {
  @IsIn(SIMPLE_ENTRY_TYPES)
  type!: SimpleEntryType;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount!: number;

  /** Document date (YYYY-MM-DD). */
  @IsDateString()
  date!: string;

  /** Funding account for non-transfer types. Ignored for deposit/withdraw. */
  @IsOptional()
  @IsIn(['CASH', 'BANK'])
  source?: 'CASH' | 'BANK';

  /** Expense category — only used when type === 'EXPENSE'. Defaults to OTHER. */
  @IsOptional()
  @IsIn(EXPENSE_CATEGORIES)
  category?: ExpenseCategory;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;

  /**
   * Where the money came from -- EQUIPMENT_PURCHASE and WAGES_PAID. Defaults
   * to CASH. 'OWNER' is only meaningful for those two kinds. For the older
   * kinds `source` is still the field; `paidFrom` CASH/BANK is accepted there
   * too so one form control can drive every kind.
   */
  @IsOptional()
  @IsIn(PAID_FROM)
  paidFrom?: PaidFrom;

  /** What was bought -- EQUIPMENT_PURCHASE only, e.g. "Espresso machine". */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  assetName?: string;
}
