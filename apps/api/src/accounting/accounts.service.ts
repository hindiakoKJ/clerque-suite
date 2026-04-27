import { Injectable, NotFoundException, ConflictException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AccountType, NormalBalance, PostingControl } from '@prisma/client';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';
export { CreateAccountDto, UpdateAccountDto };

// ─────────────────────────────────────────────────────────────────────────────
// Standard Philippine Chart of Accounts — v2 (SAP-aligned, PH GAAP / PFRS)
//
// Account nature legend
//   DEBIT  = increases with a debit  (Assets, Expenses, Contra-equity/revenue)
//   CREDIT = increases with a credit (Liabilities, Equity, Revenue, Contra-assets)
//
// PostingControl legend
//   OPEN        — manual journal entries + any module
//   SYSTEM_ONLY — auto-posted by POS / inventory scheduler only; manual JE blocked
//   AR_ONLY     — only the AR invoice module may post (Phase 5)
//   AP_ONLY     — only the AP invoice module may post (Phase 4)
//
// isSystem: true  — account cannot be deleted; core to system logic
// isSystem: false — tenant may delete if unused
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_ACCOUNTS: Omit<CreateAccountDto & { isSystem: boolean }, 'parentId'>[] = [

  // ═══════════════════════════════════════════════════════════════════════════
  // ASSETS  (1000–1999)
  // ═══════════════════════════════════════════════════════════════════════════

  // ── Cash & Bank ─────────────────────────────────────────────────────────────
  { code: '1010', name: 'Cash on Hand',                              type: 'ASSET',     normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: true  },
  { code: '1011', name: 'Petty Cash Fund',                           type: 'ASSET',     normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '1020', name: 'Cash in Bank – Current Account',            type: 'ASSET',     normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: true  },
  { code: '1021', name: 'Cash in Bank – Savings Account',            type: 'ASSET',     normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '1022', name: 'Cash in Bank – Payroll Account',            type: 'ASSET',     normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '1025', name: 'Cash Equivalents',                          type: 'ASSET',     normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },

  // ── Receivables ─────────────────────────────────────────────────────────────
  // 1030 is AR_ONLY: the AR module (Phase 5) is the only subsystem that may
  // debit/credit trade receivables to ensure aging & statement accuracy.
  { code: '1030', name: 'Accounts Receivable – Trade',               type: 'ASSET',     normalBalance: 'DEBIT',  postingControl: 'AR_ONLY',     isSystem: true  },
  // 1031 is SYSTEM_ONLY: GCash / Maya settlement is auto-posted at shift close.
  { code: '1031', name: 'Digital Wallet Receivable',                 type: 'ASSET',     normalBalance: 'DEBIT',  postingControl: 'SYSTEM_ONLY', isSystem: true  },
  // Contra-asset — credit normal balance reduces gross AR
  { code: '1032', name: 'Allowance for Doubtful Accounts',           type: 'ASSET',     normalBalance: 'CREDIT', postingControl: 'OPEN',        isSystem: false },
  { code: '1033', name: 'Notes Receivable',                          type: 'ASSET',     normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '1034', name: 'Advances to Employees',                     type: 'ASSET',     normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '1035', name: 'Due from Related Parties',                  type: 'ASSET',     normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '1036', name: 'Other Receivables',                         type: 'ASSET',     normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },

  // ── Tax Assets ──────────────────────────────────────────────────────────────
  // Input VAT: creditable against Output VAT; BIR Form 2550Q Schedule 4
  { code: '1040', name: 'Input VAT',                                 type: 'ASSET',     normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  // CWT Receivable: tax withheld BY CUSTOMERS (BIR Form 2307) — your tax credit
  { code: '1045', name: 'CWT Receivable (BIR Form 2307)',            type: 'ASSET',     normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '1046', name: 'Prepaid Income Tax',                        type: 'ASSET',     normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },

  // ── Inventories ─────────────────────────────────────────────────────────────
  // 1050 SYSTEM_ONLY: all movements (sale COGS, adjustments, stock-take) are
  // posted by the inventory scheduler with source='SYSTEM'. Prevents manual
  // overrides that would desync physical and accounting stock counts.
  { code: '1050', name: 'Merchandise Inventory',                     type: 'ASSET',     normalBalance: 'DEBIT',  postingControl: 'SYSTEM_ONLY', isSystem: true  },
  { code: '1051', name: 'Raw Materials Inventory',                   type: 'ASSET',     normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '1052', name: 'Work in Process',                           type: 'ASSET',     normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '1053', name: 'Finished Goods Inventory',                  type: 'ASSET',     normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '1054', name: 'Supplies Inventory',                        type: 'ASSET',     normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },

  // ── Prepaid & Other Current Assets ──────────────────────────────────────────
  { code: '1060', name: 'Prepaid Expenses',                          type: 'ASSET',     normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '1061', name: 'Prepaid Insurance',                         type: 'ASSET',     normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '1062', name: 'Prepaid Rent',                              type: 'ASSET',     normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '1063', name: 'Advance Deposits',                          type: 'ASSET',     normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '1064', name: 'Other Current Assets',                      type: 'ASSET',     normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },

  // ── Fixed Assets — PP&E ─────────────────────────────────────────────────────
  // 1070/1071 are the catch-all PP&E pair for simpler setups.
  // 1072+ provide granular asset class tracking (SAP AA module equivalent).
  { code: '1070', name: 'Property, Plant & Equipment',               type: 'ASSET',     normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '1071', name: 'Accumulated Depreciation – PP&E',           type: 'ASSET',     normalBalance: 'CREDIT', postingControl: 'OPEN',        isSystem: false },
  { code: '1072', name: 'Land',                                      type: 'ASSET',     normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '1073', name: 'Buildings',                                 type: 'ASSET',     normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '1074', name: 'Accumulated Depreciation – Buildings',      type: 'ASSET',     normalBalance: 'CREDIT', postingControl: 'OPEN',        isSystem: false },
  { code: '1075', name: 'Machinery & Equipment',                     type: 'ASSET',     normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '1076', name: 'Accumulated Depreciation – Machinery',      type: 'ASSET',     normalBalance: 'CREDIT', postingControl: 'OPEN',        isSystem: false },
  { code: '1077', name: 'Furniture & Fixtures',                      type: 'ASSET',     normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '1078', name: 'Accumulated Depreciation – Furniture',      type: 'ASSET',     normalBalance: 'CREDIT', postingControl: 'OPEN',        isSystem: false },
  { code: '1079', name: 'Transportation Equipment',                  type: 'ASSET',     normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '1080', name: 'Accumulated Depreciation – Transportation', type: 'ASSET',     normalBalance: 'CREDIT', postingControl: 'OPEN',        isSystem: false },
  { code: '1081', name: 'IT Equipment & Hardware',                   type: 'ASSET',     normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '1082', name: 'Accumulated Depreciation – IT Equipment',   type: 'ASSET',     normalBalance: 'CREDIT', postingControl: 'OPEN',        isSystem: false },
  { code: '1083', name: 'Leasehold Improvements',                    type: 'ASSET',     normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '1084', name: 'Accumulated Amortization – LHI',            type: 'ASSET',     normalBalance: 'CREDIT', postingControl: 'OPEN',        isSystem: false },
  { code: '1085', name: 'Construction in Progress',                  type: 'ASSET',     normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  // PFRS 16 right-of-use (operating leases recognized on balance sheet)
  { code: '1086', name: 'Right-of-Use Asset (PFRS 16)',              type: 'ASSET',     normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '1087', name: 'Accumulated Depreciation – Right-of-Use',   type: 'ASSET',     normalBalance: 'CREDIT', postingControl: 'OPEN',        isSystem: false },

  // ── Intangible Assets ────────────────────────────────────────────────────────
  { code: '1090', name: 'Goodwill',                                  type: 'ASSET',     normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '1091', name: 'Accumulated Amortization – Goodwill',       type: 'ASSET',     normalBalance: 'CREDIT', postingControl: 'OPEN',        isSystem: false },
  { code: '1092', name: 'Patents & Trademarks',                      type: 'ASSET',     normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '1093', name: 'Accumulated Amortization – Intangibles',    type: 'ASSET',     normalBalance: 'CREDIT', postingControl: 'OPEN',        isSystem: false },
  { code: '1094', name: 'Capitalized Software',                      type: 'ASSET',     normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '1095', name: 'Accumulated Amortization – Software',       type: 'ASSET',     normalBalance: 'CREDIT', postingControl: 'OPEN',        isSystem: false },

  // ── Other Non-Current Assets ────────────────────────────────────────────────
  { code: '1096', name: 'Long-term Deposits & Guarantees',           type: 'ASSET',     normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '1097', name: 'Investment in Securities',                  type: 'ASSET',     normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '1098', name: 'Investment in Subsidiaries / Associates',   type: 'ASSET',     normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '1099', name: 'Other Non-Current Assets',                  type: 'ASSET',     normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },


  // ═══════════════════════════════════════════════════════════════════════════
  // LIABILITIES  (2000–2999)
  // ═══════════════════════════════════════════════════════════════════════════

  // ── Trade Payables ──────────────────────────────────────────────────────────
  // 2010 AP_ONLY: vendor bills must flow through the AP module (Phase 4) to
  // maintain proper aging, due-date tracking, and 2307 certificate generation.
  { code: '2010', name: 'Accounts Payable – Trade',                  type: 'LIABILITY', normalBalance: 'CREDIT', postingControl: 'AP_ONLY',     isSystem: false },
  { code: '2011', name: 'Notes Payable – Trade',                     type: 'LIABILITY', normalBalance: 'CREDIT', postingControl: 'OPEN',        isSystem: false },
  { code: '2012', name: 'Accrued Trade Expenses',                    type: 'LIABILITY', normalBalance: 'CREDIT', postingControl: 'OPEN',        isSystem: false },

  // ── VAT Payables ────────────────────────────────────────────────────────────
  // 2020 SYSTEM_ONLY: the POS event processor computes and posts Output VAT
  // per transaction; manual override would break 2550Q reconciliation.
  { code: '2020', name: 'Output VAT Payable',                        type: 'LIABILITY', normalBalance: 'CREDIT', postingControl: 'SYSTEM_ONLY', isSystem: true  },
  // 2025 is used at filing time: DR Output VAT / CR Input VAT / net → 2025
  { code: '2025', name: 'VAT Payable – Net (Filing Month)',          type: 'LIABILITY', normalBalance: 'CREDIT', postingControl: 'OPEN',        isSystem: false },

  // ── Government Contributions ────────────────────────────────────────────────
  { code: '2030', name: 'SSS Contributions Payable',                 type: 'LIABILITY', normalBalance: 'CREDIT', postingControl: 'OPEN',        isSystem: false },
  { code: '2031', name: 'SSS Salary Loan Payable',                   type: 'LIABILITY', normalBalance: 'CREDIT', postingControl: 'OPEN',        isSystem: false },
  { code: '2040', name: 'PhilHealth Contributions Payable',          type: 'LIABILITY', normalBalance: 'CREDIT', postingControl: 'OPEN',        isSystem: false },
  { code: '2050', name: 'Pag-IBIG Contributions Payable',            type: 'LIABILITY', normalBalance: 'CREDIT', postingControl: 'OPEN',        isSystem: false },

  // ── Withholding Taxes ───────────────────────────────────────────────────────
  // 2060 = tax on employee compensation (BIR Form 1601-C)
  { code: '2060', name: 'Withholding Tax Payable – Compensation',    type: 'LIABILITY', normalBalance: 'CREDIT', postingControl: 'OPEN',        isSystem: false },
  // 2061 = EWT withheld FROM YOUR PAYMENTS to suppliers/contractors → BIR remit
  { code: '2061', name: 'EWT Payable – Withheld from Payees',        type: 'LIABILITY', normalBalance: 'CREDIT', postingControl: 'OPEN',        isSystem: false },
  // 2062-2064 = BIR Form 1601-EQ expanded withholding by payee type
  { code: '2062', name: 'EWT Payable – Professionals (15% / 10%)',   type: 'LIABILITY', normalBalance: 'CREDIT', postingControl: 'OPEN',        isSystem: false },
  { code: '2063', name: 'EWT Payable – Rentals (5%)',                type: 'LIABILITY', normalBalance: 'CREDIT', postingControl: 'OPEN',        isSystem: false },
  { code: '2064', name: 'EWT Payable – Goods & Services (1%)',       type: 'LIABILITY', normalBalance: 'CREDIT', postingControl: 'OPEN',        isSystem: false },
  { code: '2065', name: 'Income Tax Payable',                        type: 'LIABILITY', normalBalance: 'CREDIT', postingControl: 'OPEN',        isSystem: false },

  // ── Accrued Liabilities ─────────────────────────────────────────────────────
  { code: '2080', name: 'Accrued Liabilities',                       type: 'LIABILITY', normalBalance: 'CREDIT', postingControl: 'OPEN',        isSystem: false },
  { code: '2081', name: 'Accrued Salaries & Wages',                  type: 'LIABILITY', normalBalance: 'CREDIT', postingControl: 'OPEN',        isSystem: false },
  { code: '2082', name: 'Accrued Vacation Leave Pay',                type: 'LIABILITY', normalBalance: 'CREDIT', postingControl: 'OPEN',        isSystem: false },
  { code: '2083', name: 'Accrued 13th Month Pay',                    type: 'LIABILITY', normalBalance: 'CREDIT', postingControl: 'OPEN',        isSystem: false },

  // ── Other Current Liabilities ────────────────────────────────────────────────
  { code: '2070', name: 'Loans Payable',                             type: 'LIABILITY', normalBalance: 'CREDIT', postingControl: 'OPEN',        isSystem: false },
  { code: '2071', name: 'Bank Loans – Short-term',                   type: 'LIABILITY', normalBalance: 'CREDIT', postingControl: 'OPEN',        isSystem: false },
  { code: '2072', name: 'Current Portion of Long-term Debt',         type: 'LIABILITY', normalBalance: 'CREDIT', postingControl: 'OPEN',        isSystem: false },
  { code: '2073', name: 'Finance Lease Liability – Current',         type: 'LIABILITY', normalBalance: 'CREDIT', postingControl: 'OPEN',        isSystem: false },
  { code: '2074', name: 'Customer Deposits & Advances',              type: 'LIABILITY', normalBalance: 'CREDIT', postingControl: 'OPEN',        isSystem: false },
  { code: '2075', name: 'Unearned Revenue',                          type: 'LIABILITY', normalBalance: 'CREDIT', postingControl: 'OPEN',        isSystem: false },
  { code: '2076', name: 'Dividends Payable',                         type: 'LIABILITY', normalBalance: 'CREDIT', postingControl: 'OPEN',        isSystem: false },
  { code: '2077', name: 'Other Current Liabilities',                 type: 'LIABILITY', normalBalance: 'CREDIT', postingControl: 'OPEN',        isSystem: false },

  // ── Non-Current Liabilities ──────────────────────────────────────────────────
  { code: '2090', name: 'Long-term Bank Loans',                      type: 'LIABILITY', normalBalance: 'CREDIT', postingControl: 'OPEN',        isSystem: false },
  { code: '2091', name: 'Mortgage Payable',                          type: 'LIABILITY', normalBalance: 'CREDIT', postingControl: 'OPEN',        isSystem: false },
  { code: '2092', name: 'Finance Lease Liability – Non-current',     type: 'LIABILITY', normalBalance: 'CREDIT', postingControl: 'OPEN',        isSystem: false },
  { code: '2093', name: 'Lease Liability (PFRS 16)',                  type: 'LIABILITY', normalBalance: 'CREDIT', postingControl: 'OPEN',        isSystem: false },
  { code: '2094', name: 'Retirement Benefit Obligation',             type: 'LIABILITY', normalBalance: 'CREDIT', postingControl: 'OPEN',        isSystem: false },
  { code: '2095', name: 'Deferred Tax Liability',                    type: 'LIABILITY', normalBalance: 'CREDIT', postingControl: 'OPEN',        isSystem: false },
  { code: '2096', name: 'Other Non-Current Liabilities',             type: 'LIABILITY', normalBalance: 'CREDIT', postingControl: 'OPEN',        isSystem: false },


  // ═══════════════════════════════════════════════════════════════════════════
  // EQUITY  (3000–3999)
  // ═══════════════════════════════════════════════════════════════════════════

  // Sole proprietorship / SME defaults
  { code: '3010', name: "Owner's Capital",                           type: 'EQUITY',    normalBalance: 'CREDIT', postingControl: 'OPEN',        isSystem: false },
  { code: '3020', name: "Owner's Drawing",                           type: 'EQUITY',    normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '3030', name: 'Retained Earnings',                         type: 'EQUITY',    normalBalance: 'CREDIT', postingControl: 'OPEN',        isSystem: false },

  // Corporation accounts (use when business is registered as a corp)
  { code: '3040', name: 'Share Capital – Ordinary',                  type: 'EQUITY',    normalBalance: 'CREDIT', postingControl: 'OPEN',        isSystem: false },
  { code: '3041', name: 'Share Premium',                             type: 'EQUITY',    normalBalance: 'CREDIT', postingControl: 'OPEN',        isSystem: false },
  { code: '3042', name: 'Accumulated Other Comprehensive Income',    type: 'EQUITY',    normalBalance: 'CREDIT', postingControl: 'OPEN',        isSystem: false },
  // Contra-equity — debit normal balance reduces total equity
  { code: '3043', name: 'Treasury Shares',                           type: 'EQUITY',    normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },

  // Partnership accounts
  { code: '3050', name: "Partner's Capital",                         type: 'EQUITY',    normalBalance: 'CREDIT', postingControl: 'OPEN',        isSystem: false },
  { code: '3051', name: "Partner's Drawing",                         type: 'EQUITY',    normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },


  // ═══════════════════════════════════════════════════════════════════════════
  // REVENUE  (4000–4999)
  // ═══════════════════════════════════════════════════════════════════════════

  // ── POS Revenue — SYSTEM_ONLY ────────────────────────────────────────────────
  // These three accounts are auto-posted by the POS accounting event queue.
  // Manual journal entries to them are BLOCKED to prevent reconciliation gaps.
  { code: '4010', name: 'Sales Revenue – POS',                       type: 'REVENUE',   normalBalance: 'CREDIT', postingControl: 'SYSTEM_ONLY', isSystem: true  },
  // Contra-revenue — debit normal balance reduces gross sales
  { code: '4020', name: 'Sales Discounts – POS',                     type: 'REVENUE',   normalBalance: 'DEBIT',  postingControl: 'SYSTEM_ONLY', isSystem: true  },
  { code: '4030', name: 'Sales Returns & Allowances – POS',          type: 'REVENUE',   normalBalance: 'DEBIT',  postingControl: 'SYSTEM_ONLY', isSystem: true  },

  // ── Invoice / AR Revenue — AR_ONLY ──────────────────────────────────────────
  // Revenue from customer invoices flows through the AR module (Phase 5).
  { code: '4015', name: 'Sales Revenue – Invoice',                   type: 'REVENUE',   normalBalance: 'CREDIT', postingControl: 'AR_ONLY',     isSystem: false },
  { code: '4041', name: 'Service Revenue – Invoice',                 type: 'REVENUE',   normalBalance: 'CREDIT', postingControl: 'AR_ONLY',     isSystem: false },

  // ── Open Revenue ────────────────────────────────────────────────────────────
  { code: '4040', name: 'Service Revenue',                           type: 'REVENUE',   normalBalance: 'CREDIT', postingControl: 'OPEN',        isSystem: false },
  { code: '4050', name: 'Other Income',                              type: 'REVENUE',   normalBalance: 'CREDIT', postingControl: 'OPEN',        isSystem: false },
  { code: '4060', name: 'Rental Income',                             type: 'REVENUE',   normalBalance: 'CREDIT', postingControl: 'OPEN',        isSystem: false },
  { code: '4070', name: 'Interest Income',                           type: 'REVENUE',   normalBalance: 'CREDIT', postingControl: 'OPEN',        isSystem: false },
  { code: '4080', name: 'Dividend Income',                           type: 'REVENUE',   normalBalance: 'CREDIT', postingControl: 'OPEN',        isSystem: false },
  { code: '4090', name: 'Gain on Sale of Assets',                    type: 'REVENUE',   normalBalance: 'CREDIT', postingControl: 'OPEN',        isSystem: false },
  { code: '4091', name: 'Foreign Exchange Gain',                     type: 'REVENUE',   normalBalance: 'CREDIT', postingControl: 'OPEN',        isSystem: false },
  { code: '4092', name: 'Miscellaneous Income',                      type: 'REVENUE',   normalBalance: 'CREDIT', postingControl: 'OPEN',        isSystem: false },


  // ═══════════════════════════════════════════════════════════════════════════
  // COST OF GOODS SOLD  (5000–5999)
  // ═══════════════════════════════════════════════════════════════════════════

  // 5010 SYSTEM_ONLY: POS auto-posts COGS per item sold using moving average cost.
  { code: '5010', name: 'Cost of Goods Sold – POS',                  type: 'EXPENSE',   normalBalance: 'DEBIT',  postingControl: 'SYSTEM_ONLY', isSystem: true  },
  // 5020 AR_ONLY: COGS for invoiced sales posted by the AR module.
  { code: '5020', name: 'Cost of Goods Sold – Direct Sales',         type: 'EXPENSE',   normalBalance: 'DEBIT',  postingControl: 'AR_ONLY',     isSystem: false },
  { code: '5030', name: 'Freight In & Import Costs',                 type: 'EXPENSE',   normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  // Contra-expense accounts — credit normal balance reduces net COGS
  { code: '5040', name: 'Purchase Returns & Allowances',             type: 'EXPENSE',   normalBalance: 'CREDIT', postingControl: 'OPEN',        isSystem: false },
  { code: '5050', name: 'Purchase Discounts',                        type: 'EXPENSE',   normalBalance: 'CREDIT', postingControl: 'OPEN',        isSystem: false },
  { code: '5060', name: 'Inventory Write-off Expense',               type: 'EXPENSE',   normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '5070', name: 'Spoilage & Waste',                          type: 'EXPENSE',   normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '5080', name: 'Direct Labor – Production',                 type: 'EXPENSE',   normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '5090', name: 'Manufacturing Overhead',                    type: 'EXPENSE',   normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },


  // ═══════════════════════════════════════════════════════════════════════════
  // OPERATING EXPENSES  (6000–6999)
  // ═══════════════════════════════════════════════════════════════════════════

  // ── Payroll & Employee Costs ─────────────────────────────────────────────────
  { code: '6010', name: 'Salaries and Wages',                        type: 'EXPENSE',   normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '6011', name: 'Overtime Pay',                              type: 'EXPENSE',   normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '6012', name: 'Holiday & Rest Day Pay',                    type: 'EXPENSE',   normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '6013', name: '13th Month Pay',                            type: 'EXPENSE',   normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '6014', name: 'Employee Benefits',                         type: 'EXPENSE',   normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '6015', name: 'Meal & Clothing Allowance',                 type: 'EXPENSE',   normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '6016', name: 'Recruitment & Onboarding Expense',          type: 'EXPENSE',   normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '6017', name: 'Training & Development',                    type: 'EXPENSE',   normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '6018', name: 'Medical & Clinic Expense',                  type: 'EXPENSE',   normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '6020', name: 'SSS Employer Contribution',                 type: 'EXPENSE',   normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '6030', name: 'PhilHealth Employer Contribution',          type: 'EXPENSE',   normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '6040', name: 'Pag-IBIG Employer Contribution',            type: 'EXPENSE',   normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },

  // ── Facilities & Operations ──────────────────────────────────────────────────
  { code: '6050', name: 'Rent Expense',                              type: 'EXPENSE',   normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '6051', name: 'Rent – Office',                             type: 'EXPENSE',   normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '6052', name: 'Rent – Warehouse / Storage',                type: 'EXPENSE',   normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '6060', name: 'Utilities Expense',                         type: 'EXPENSE',   normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '6061', name: 'Electricity Expense',                       type: 'EXPENSE',   normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '6062', name: 'Water Expense',                             type: 'EXPENSE',   normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '6063', name: 'Gas & Fuel Expense',                        type: 'EXPENSE',   normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '6070', name: 'Office Supplies Expense',                   type: 'EXPENSE',   normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '6080', name: 'Depreciation Expense',                      type: 'EXPENSE',   normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '6081', name: 'Amortization Expense',                      type: 'EXPENSE',   normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '6090', name: 'Repairs and Maintenance',                   type: 'EXPENSE',   normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '6091', name: 'Building Maintenance',                      type: 'EXPENSE',   normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '6092', name: 'Equipment Maintenance',                     type: 'EXPENSE',   normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },

  // ── Transportation & Communication ───────────────────────────────────────────
  { code: '6100', name: 'Transportation and Travel',                 type: 'EXPENSE',   normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '6101', name: 'Gasoline & Oil Expense',                    type: 'EXPENSE',   normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '6102', name: 'Vehicle Maintenance',                       type: 'EXPENSE',   normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '6110', name: 'Communication Expense',                     type: 'EXPENSE',   normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '6111', name: 'Internet & Data Expense',                   type: 'EXPENSE',   normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '6112', name: 'Postage & Courier Expense',                 type: 'EXPENSE',   normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },

  // ── Insurance ────────────────────────────────────────────────────────────────
  { code: '6120', name: 'Insurance Expense',                         type: 'EXPENSE',   normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },

  // ── Selling & Marketing ──────────────────────────────────────────────────────
  { code: '6130', name: 'Advertising Expense',                       type: 'EXPENSE',   normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '6131', name: 'Sales Promotions & Campaigns',              type: 'EXPENSE',   normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '6132', name: 'Freight Out & Delivery Expense',            type: 'EXPENSE',   normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '6133', name: 'Bad Debts Expense',                         type: 'EXPENSE',   normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  // EAR limit: 0.5% of net income for individuals; 1% of net revenue for corps
  { code: '6135', name: 'Entertainment, Amusement & Recreation',     type: 'EXPENSE',   normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },

  // ── General & Administrative ─────────────────────────────────────────────────
  { code: '6140', name: 'Miscellaneous Expense',                     type: 'EXPENSE',   normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '6141', name: 'Professional Fees',                         type: 'EXPENSE',   normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '6142', name: 'Legal Fees',                                type: 'EXPENSE',   normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '6143', name: 'Audit & Accounting Fees',                   type: 'EXPENSE',   normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '6144', name: 'Consulting Fees',                           type: 'EXPENSE',   normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '6145', name: 'Security Services',                         type: 'EXPENSE',   normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '6146', name: 'Janitorial Services',                       type: 'EXPENSE',   normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '6147', name: 'Messengerial & Agency Services',            type: 'EXPENSE',   normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '6148', name: 'IT Services & Software Subscriptions',      type: 'EXPENSE',   normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '6149', name: 'Dues & Subscriptions',                      type: 'EXPENSE',   normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },

  // ── Production & Projects (legacy series, preserved) ────────────────────────
  { code: '6150', name: 'Production Materials Expense',              type: 'EXPENSE',   normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '6160', name: 'Project Direct Materials',                  type: 'EXPENSE',   normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '6170', name: 'Contractor Fees Expense',                   type: 'EXPENSE',   normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '6180', name: 'Commission Expense',                        type: 'EXPENSE',   normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },

  // ── Taxes & Regulatory ───────────────────────────────────────────────────────
  { code: '6190', name: 'Taxes and Licenses',                        type: 'EXPENSE',   normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '6191', name: 'Real Property Tax',                         type: 'EXPENSE',   normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '6192', name: 'Business Permits & Licenses',               type: 'EXPENSE',   normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '6193', name: 'Documentary Stamp Tax',                     type: 'EXPENSE',   normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '6194', name: 'Donations & Contributions',                 type: 'EXPENSE',   normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },

  // ── Equipment & Tools ────────────────────────────────────────────────────────
  { code: '6200', name: 'Equipment Expense',                         type: 'EXPENSE',   normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '6210', name: 'Tools and Supplies Expense',                type: 'EXPENSE',   normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '6211', name: 'IT Supplies & Peripherals',                 type: 'EXPENSE',   normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },


  // ═══════════════════════════════════════════════════════════════════════════
  // FINANCE COSTS & OTHER EXPENSES  (7000–7999)
  // ═══════════════════════════════════════════════════════════════════════════

  { code: '7010', name: 'Interest Expense',                          type: 'EXPENSE',   normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '7011', name: 'Bank Service Charges',                      type: 'EXPENSE',   normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '7012', name: 'Finance Charges & Fees',                    type: 'EXPENSE',   normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '7020', name: 'Foreign Exchange Loss',                     type: 'EXPENSE',   normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '7030', name: 'Loss on Sale of Assets',                    type: 'EXPENSE',   normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '7040', name: 'Other Finance Costs',                       type: 'EXPENSE',   normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },


  // ═══════════════════════════════════════════════════════════════════════════
  // INCOME TAX EXPENSE  (8000–8999)
  // ═══════════════════════════════════════════════════════════════════════════

  // Separate from operating expenses per PAS 12 / PFRS presentation.
  { code: '8010', name: 'Current Income Tax Expense',                type: 'EXPENSE',   normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
  { code: '8020', name: 'Deferred Tax Expense / (Benefit)',          type: 'EXPENSE',   normalBalance: 'DEBIT',  postingControl: 'OPEN',        isSystem: false },
];

@Injectable()
export class AccountsService {
  constructor(private prisma: PrismaService) {}

  // ── Seed defaults for a new tenant ──────────────────────────────────────────

  async seedDefaultAccounts(tenantId: string): Promise<void> {
    // Fetch only the codes that already exist so we can insert the missing ones.
    // This lets new accounts added to DEFAULT_ACCOUNTS be back-filled for
    // existing tenants without touching or duplicating anything already there.
    const existingCodes = await this.prisma.account
      .findMany({ where: { tenantId }, select: { code: true } })
      .then((rows) => new Set(rows.map((r) => r.code)));

    const missing = DEFAULT_ACCOUNTS.filter((a) => !existingCodes.has(a.code));
    if (missing.length === 0) return;

    await this.prisma.account.createMany({
      data: missing.map((a) => ({ ...a, tenantId })),
      skipDuplicates: true,
    });
  }

  // ── Read ────────────────────────────────────────────────────────────────────

  async findAll(tenantId: string) {
    // Always sync — inserts any DEFAULT_ACCOUNTS codes missing for this tenant.
    // No-ops instantly if nothing is missing (Set diff = 0).
    await this.seedDefaultAccounts(tenantId);

    return this.prisma.account.findMany({
      where: { tenantId },
      orderBy: [{ type: 'asc' }, { code: 'asc' }],
      include: { parent: { select: { id: true, code: true, name: true } } },
    });
  }

  async findOne(tenantId: string, id: string) {
    const account = await this.prisma.account.findFirst({
      where: { id, tenantId },
      include: {
        parent:   { select: { id: true, code: true, name: true } },
        children: { select: { id: true, code: true, name: true, isActive: true } },
      },
    });
    if (!account) throw new NotFoundException('Account not found');
    return account;
  }

  async findByCode(tenantId: string, code: string) {
    return this.prisma.account.findUnique({ where: { tenantId_code: { tenantId, code } } });
  }

  // ── Write (Super Admin only — enforced at controller layer) ─────────────────

  async create(tenantId: string, dto: CreateAccountDto) {
    const existing = await this.prisma.account.findUnique({
      where: { tenantId_code: { tenantId, code: dto.code } },
    });
    if (existing) throw new ConflictException(`Account code ${dto.code} already exists`);
    return this.prisma.account.create({ data: { ...dto, tenantId } });
  }

  async update(tenantId: string, id: string, dto: UpdateAccountDto) {
    const account = await this.prisma.account.findFirst({ where: { id, tenantId } });
    if (!account) throw new NotFoundException('Account not found');
    if (account.isSystem && dto.postingControl !== undefined) {
      throw new ForbiddenException('Posting control on system accounts cannot be changed');
    }
    return this.prisma.account.update({ where: { id }, data: dto });
  }

  async delete(tenantId: string, id: string) {
    const account = await this.prisma.account.findFirst({ where: { id, tenantId } });
    if (!account) throw new NotFoundException('Account not found');
    if (account.isSystem) throw new ForbiddenException('System accounts cannot be deleted');

    const usedInLines = await this.prisma.journalLine.count({ where: { accountId: id } });
    if (usedInLines > 0) {
      throw new ConflictException('Account has journal entries and cannot be deleted. Deactivate it instead.');
    }
    return this.prisma.account.delete({ where: { id } });
  }

  // ── Trial Balance ────────────────────────────────────────────────────────────

  async getTrialBalance(tenantId: string, asOf?: string) {
    // Use postingDate for period filtering; fall back to document date for legacy entries.
    const asOfDate  = asOf ? new Date(asOf) : undefined;
    const jeFilter: Record<string, unknown> = { tenantId, status: 'POSTED' };
    if (asOfDate) {
      jeFilter['OR'] = [
        { postingDate: { lte: asOfDate } },
        { postingDate: null, date: { lte: asOfDate } },
      ];
    }

    const accounts = await this.prisma.account.findMany({
      where: { tenantId, isActive: true },
      orderBy: [{ type: 'asc' }, { code: 'asc' }],
      include: {
        journalLines: {
          where: { journalEntry: jeFilter as any },
          select: { debit: true, credit: true },
        },
      },
    });

    let totalDebits = 0;
    let totalCredits = 0;

    const rows = accounts
      .map((acct) => {
        const debit  = acct.journalLines.reduce((s, l) => s + Number(l.debit),  0);
        const credit = acct.journalLines.reduce((s, l) => s + Number(l.credit), 0);
        totalDebits  += debit;
        totalCredits += credit;
        return {
          id:             acct.id,
          code:           acct.code,
          name:           acct.name,
          type:           acct.type,
          normalBalance:  acct.normalBalance,
          postingControl: acct.postingControl,
          debit,
          credit,
          balance: acct.normalBalance === 'DEBIT' ? debit - credit : credit - debit,
        };
      })
      .filter((r) => r.debit > 0 || r.credit > 0); // omit zero-balance accounts

    return { rows, totalDebits, totalCredits, isBalanced: Math.abs(totalDebits - totalCredits) < 0.01 };
  }

  // ── General Ledger (per-account history) ─────────────────────────────────────

  async getAccountLedger(
    tenantId: string,
    accountId: string,
    opts: { from?: string; to?: string; page?: number },
  ) {
    const { from, to, page = 1 } = opts;
    const take = 50;
    const skip = (page - 1) * take;

    const account = await this.findOne(tenantId, accountId);

    // Use postingDate for period filtering; fall back to document date for legacy entries.
    const dateRange = (from || to) ? {
      ...(from ? { gte: new Date(from) } : {}),
      ...(to   ? { lte: new Date(to)   } : {}),
    } : undefined;

    const jeFilter: Record<string, unknown> = { tenantId, status: 'POSTED' as const };
    if (dateRange) {
      jeFilter['OR'] = [
        { postingDate: dateRange },
        { postingDate: null, date: dateRange },
      ];
    }

    const where = {
      accountId,
      journalEntry: jeFilter as any,
    };

    const [total, lines] = await Promise.all([
      this.prisma.journalLine.count({ where }),
      this.prisma.journalLine.findMany({
        where,
        orderBy: { journalEntry: { postingDate: 'asc' } },
        skip,
        take,
        include: {
          journalEntry: {
            select: {
              id:          true,
              entryNumber: true,
              date:        true,
              postingDate: true,
              description: true,
              reference:   true,
              source:      true,
            },
          },
        },
      }),
    ]);

    // Compute running balance; order is by postingDate asc (set in orderBy above)
    let runningBalance = 0;
    const rows = lines.map((l) => {
      const dr = Number(l.debit);
      const cr = Number(l.credit);
      runningBalance += account.normalBalance === 'DEBIT' ? dr - cr : cr - dr;
      return {
        id:            l.id,
        documentDate:  l.journalEntry.date,
        postingDate:   l.journalEntry.postingDate ?? l.journalEntry.date,
        entryNumber:   l.journalEntry.entryNumber,
        entryId:       l.journalEntry.id,
        description:   l.description ?? l.journalEntry.description,
        reference:     l.journalEntry.reference,
        source:        l.journalEntry.source,
        debit:         dr,
        credit:        cr,
        runningBalance,
      };
    });

    return {
      account: {
        id:            account.id,
        code:          account.code,
        name:          account.name,
        type:          account.type,
        normalBalance: account.normalBalance,
      },
      rows,
      total,
      page,
      pages: Math.ceil(total / take),
    };
  }

  // ── P&L Summary ──────────────────────────────────────────────────────────────

  async getPLSummary(tenantId: string, from: string, to: string) {
    // Use postingDate for period filtering; fall back to document date for legacy entries.
    const dateRange = { gte: new Date(from), lte: new Date(to) };
    const plJeFilter = {
      tenantId,
      status: 'POSTED',
      OR: [
        { postingDate: dateRange },
        { postingDate: null, date: dateRange },
      ],
    };

    const accounts = await this.prisma.account.findMany({
      where: { tenantId, isActive: true, type: { in: ['REVENUE', 'EXPENSE'] } },
      orderBy: [{ type: 'asc' }, { code: 'asc' }],
      include: {
        journalLines: {
          where: { journalEntry: plJeFilter as any },
          select: { debit: true, credit: true },
        },
      },
    });

    let totalRevenue = 0;
    let totalExpenses = 0;
    const revenueAccounts: { id: string; code: string; name: string; balance: number }[] = [];
    const expenseAccounts: { id: string; code: string; name: string; balance: number }[] = [];

    for (const acct of accounts) {
      const debit   = acct.journalLines.reduce((s, l) => s + Number(l.debit),  0);
      const credit  = acct.journalLines.reduce((s, l) => s + Number(l.credit), 0);
      const balance = acct.normalBalance === 'DEBIT' ? debit - credit : credit - debit;
      const row = { id: acct.id, code: acct.code, name: acct.name, balance };
      if (acct.type === 'REVENUE') { revenueAccounts.push(row); totalRevenue  += balance; }
      else                         { expenseAccounts.push(row); totalExpenses += balance; }
    }

    return { from, to, revenueAccounts, expenseAccounts, totalRevenue, totalExpenses, netIncome: totalRevenue - totalExpenses };
  }
}
