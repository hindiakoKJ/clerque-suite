# Data Classification Policy

**Document ID:** D2-05
**Owner:** Kristian JV Sacdalan (acting DPO)
**Last reviewed:** 2026-05-11
**Next review:** 2027-05-11

---

## 1. Purpose

Define three handling tiers so that every Clerque developer, contractor, and operations decision can answer one question quickly: *"How carefully do I need to treat this data?"*

Default tier when unsure: **SENSITIVE-PII**.

## 2. The three tiers

### Tier 1 — PUBLIC

Information that is, or is intended to be, freely available to the world.

- **Examples:** marketing copy on clerque.ph, the public pricing page, blog posts, the open-source portions of the SDK (if/when published).
- **Handling:** no restrictions. May be cached on any CDN.
- **Retention:** indefinite. Versioned in git.
- **Disposal:** delete from git history only if it contained a mistake (e.g. accidental price leak); otherwise leave.
- **Export rules:** none.

### Tier 2 — INTERNAL

Operational data that is not secret but should not be public. Disclosure would be embarrassing or competitively unhelpful, not legally consequential.

- **Examples:** Railway/Vercel cost dashboards, aggregated MRR, tenant counts, anonymised usage telemetry, internal Notion runbooks, planning docs in `tasks/`.
- **Handling:** stored in tools listed in `VENDORS.md`. Access on a need-to-know basis. Not pasted into AI tools without aggregation.
- **Retention:** 3 years rolling. Older snapshots may be deleted to reduce surface.
- **Disposal:** standard delete in the source-of-truth tool. No special wipe required.
- **Export rules:** founder approval before sharing outside the company.

### Tier 3 — SENSITIVE-PII

Everything covered by RA 10173 (Philippine Data Privacy Act) personal-information definition, plus all BIR-required ledger evidence, plus all credential and authentication material. Disclosure can trigger regulator action and direct harm to tenants and their employees.

- **Examples:** customer TIN, employee TIN/SSS/PhilHealth/PagIBIG numbers, salary and payslip data, supervisor PINs, kiosk PINs, server-side JWT secret, hashed passwords, refresh tokens, full Order history with customer names, BIR-required Z-reads and journal entries.
- **Handling:**
  - Encrypted in transit (TLS 1.2+) and at rest (Railway Postgres encryption + R2 SSE-S3).
  - Access is scoped per-tenant by NestJS guards and Prisma `tenantId` filters.
  - **Never** sent to Anthropic. Prompts to the AI Drafter strip raw PII and send only COA names and memo strings.
  - **Never** copied to personal devices, personal cloud, screenshots, or Slack.
- **Retention:**
  - BIR-required records: 10 years from the close of the taxable year (BIR Section 235).
  - Non-BIR PII: kept for the active life of the tenant + 1 year for billing/dispute defence, then purged.
  - Authentication artefacts (refresh tokens, sessions): purged on logout, on offboarding, or after 30 days idle, whichever comes first.
- **Disposal:**
  - Database: `DELETE` with confirmation, plus the nightly backup containing the row will age out per the R2 retention window.
  - Backups: R2 lifecycle rule rolls off backups older than 90 days; BIR-required exports are taken to immutable archive before the 90-day rollover for the 10-year obligation.
- **Export rules:**
  - DPO sign-off required for every export of SENSITIVE-PII outside the production system.
  - All exports are logged in `AuditLog` with actor, scope, and reason.
  - Tenants requesting their own data (RA 10173 §16 access right) receive a per-tenant export within 30 days.

## 3. Prisma model → tier mapping

| Tier | Models |
|---|---|
| **PUBLIC** | `PlatformConfig` (when used for marketing-tier toggles only) |
| **INTERNAL** | `SubscriptionLog`, `ConsoleLog`, `Notification`, `AiUsage`, `TenantDataSnapshot` (aggregate counts only), `PlatformConfig` (when used for ops flags) |
| **SENSITIVE-PII** | `SuperAdmin`, `SuperAdminSession`, `Tenant`, `AuditLog`, `Branch`, `User`, `UserAppAccess`, `UserSession`, `TrustedDevice`, `LoginLog`, `Category`, `Product`, `ProductVariant`, `RawMaterial`, `VariantBomItem`, `BomItem`, `InventoryItem`, `RawMaterialInventory`, `InventoryLog`, `Promotion`, `PromotionProduct`, `DiscountTypeConfig`, `PaymentChannelConfig`, `Order`, `OrderItem`, `OrderItemRefund`, `OrderPayment`, `OrderDiscount`, `Shift`, `ShiftCashOut`, `AccountingEvent`, `Account`, `JournalEntry`, `JournalLine`, `ModifierGroup`, `ModifierOption`, `ProductModifierGroup`, `OrderItemModifier`, `UnitOfMeasure`, `SettlementBatch`, `SettlementItem`, `AccountingPeriod`, `ZReadLog`, `XReadLog`, `Vendor`, `ExpenseEntry`, `Customer`, `StampCardTemplate`, `CustomerStampCard`, `StampCardEvent`, `KioskTerminal`, `DeliveryReceipt`, `DeliveryReceiptItem`, `ARInvoice`, `ARInvoiceLine`, `ARPayment`, `ARPaymentApplication`, `APBill`, `APBillLine`, `APPayment`, `APPaymentApplication`, `DocumentNumberSequence`, `TimeEntry`, `PayRun`, `Payslip`, `Document`, `OrSequence`, `ExpenseClaim`, `ExpenseClaimItem`, `ExpenseClaimSequence`, `BankReconciliation`, `BankReconciliationItem`, `JournalTemplate`, `Station`, `Printer`, `Terminal`, `RawMaterialLot`, `LaundryOrder`, `LaundryItem`, `LaundryMachine`, `LaundryWashCycle`, `LaundryServicePrice`, `LaundryOrderLine`, `LaundryProductLine`, `LaundryPromo`, `LaundryPromoApplication`, `LaundryServiceAddOn`, `LaundryOrderLineAddOn`, `LeaveRequest`, `EmployeeRequest`, `ThirteenthMonth`, `StockTransfer`, `StockTransferLine`, `CycleCount`, `CycleCountLine`, `Project`, `MaterialIssuance`, `MaterialIssuanceLine`, `Prescription`, `ProductLot`, `ControlledSubstanceLog`, `FleetAsset`, `PMSchedule`, `TireSerial`, `TripTicket`, `LiquidationItem`, `ProgressBilling`, `RetentionRelease`, `JobOrder`, `JobOrderLine` |

Any model added to the schema after this date defaults to **SENSITIVE-PII** until the DPO explicitly reclassifies it.
