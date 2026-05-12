-- Sprint 22 — AR/AP standalone-accounting parity (Xero/QB feature set)
-- ------------------------------------------------------------------
-- Adds: CreditMemo + VendorCreditNote + CustomerAdvance + VendorAdvance
--       + RecurringInvoiceTemplate + RecurringBillTemplate
-- + 6 new SequenceType enum values
-- + 2 new columns on ARInvoice/APBill (recurringTemplateId)
-- Manual SQL because no live DB available to `prisma migrate dev` against.

-- ─── Enums ───────────────────────────────────────────────────────────

ALTER TYPE "SequenceType" ADD VALUE 'AR_CREDIT_MEMO';
ALTER TYPE "SequenceType" ADD VALUE 'AP_CREDIT_NOTE';
ALTER TYPE "SequenceType" ADD VALUE 'CUSTOMER_ADVANCE';
ALTER TYPE "SequenceType" ADD VALUE 'VENDOR_ADVANCE';
ALTER TYPE "SequenceType" ADD VALUE 'RECURRING_INVOICE';
ALTER TYPE "SequenceType" ADD VALUE 'RECURRING_BILL';

CREATE TYPE "CreditMemoStatus" AS ENUM ('DRAFT', 'POSTED', 'APPLIED', 'VOIDED');
CREATE TYPE "CreditMemoReason" AS ENUM ('RETURN', 'PRICE_ADJUSTMENT', 'BILLING_ERROR', 'GOODWILL', 'BAD_DEBT_WRITE_OFF', 'OTHER');
CREATE TYPE "VendorCreditNoteStatus" AS ENUM ('DRAFT', 'POSTED', 'APPLIED', 'VOIDED');
CREATE TYPE "VendorCreditNoteReason" AS ENUM ('RETURN', 'PRICE_ADJUSTMENT', 'BILLING_ERROR', 'REBATE', 'OTHER');
CREATE TYPE "AdvanceStatus" AS ENUM ('DRAFT', 'POSTED', 'APPLIED', 'REFUNDED', 'VOIDED');
CREATE TYPE "RecurrenceFrequency" AS ENUM ('WEEKLY', 'MONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'YEARLY');
CREATE TYPE "RecurringTemplateStatus" AS ENUM ('ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED');

-- ─── ARInvoice / APBill: recurringTemplateId column ──────────────────

ALTER TABLE "ar_invoices" ADD COLUMN "recurringTemplateId" TEXT;
CREATE INDEX "ar_invoices_tenantId_recurringTemplateId_idx" ON "ar_invoices"("tenantId", "recurringTemplateId");

ALTER TABLE "ap_bills" ADD COLUMN "recurringTemplateId" TEXT;
CREATE INDEX "ap_bills_tenantId_recurringTemplateId_idx" ON "ap_bills"("tenantId", "recurringTemplateId");

-- ─── credit_memos ─────────────────────────────────────────────────────

CREATE TABLE "credit_memos" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "branchId" TEXT,
  "memoNumber" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "memoDate" TIMESTAMP(3) NOT NULL,
  "postingDate" TIMESTAMP(3) NOT NULL,
  "reason" "CreditMemoReason" NOT NULL DEFAULT 'OTHER',
  "reasonNotes" TEXT,
  "relatedInvoiceId" TEXT,
  "subtotal" DECIMAL(14,2) NOT NULL,
  "vatAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "totalAmount" DECIMAL(14,2) NOT NULL,
  "appliedAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "unappliedAmount" DECIMAL(14,2) NOT NULL,
  "status" "CreditMemoStatus" NOT NULL DEFAULT 'DRAFT',
  "description" TEXT,
  "notes" TEXT,
  "createdById" TEXT NOT NULL,
  "postedById" TEXT,
  "postedAt" TIMESTAMP(3),
  "voidedById" TEXT,
  "voidedAt" TIMESTAMP(3),
  "voidReason" TEXT,
  "journalEntryId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "credit_memos_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "credit_memos_journalEntryId_key" ON "credit_memos"("journalEntryId");
CREATE UNIQUE INDEX "credit_memos_tenantId_memoNumber_key" ON "credit_memos"("tenantId", "memoNumber");
CREATE INDEX "credit_memos_tenantId_customerId_status_idx" ON "credit_memos"("tenantId", "customerId", "status");
CREATE INDEX "credit_memos_tenantId_postingDate_idx" ON "credit_memos"("tenantId", "postingDate");

ALTER TABLE "credit_memos" ADD CONSTRAINT "credit_memos_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE;
ALTER TABLE "credit_memos" ADD CONSTRAINT "credit_memos_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL;
ALTER TABLE "credit_memos" ADD CONSTRAINT "credit_memos_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT;
ALTER TABLE "credit_memos" ADD CONSTRAINT "credit_memos_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id") ON DELETE SET NULL;

CREATE TABLE "credit_memo_lines" (
  "id" TEXT NOT NULL,
  "memoId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "description" TEXT,
  "quantity" DECIMAL(14,4) NOT NULL DEFAULT 1,
  "unitPrice" DECIMAL(14,2) NOT NULL,
  "taxAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "lineTotal" DECIMAL(14,2) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "credit_memo_lines_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "credit_memo_lines_memoId_idx" ON "credit_memo_lines"("memoId");
ALTER TABLE "credit_memo_lines" ADD CONSTRAINT "credit_memo_lines_memoId_fkey" FOREIGN KEY ("memoId") REFERENCES "credit_memos"("id") ON DELETE CASCADE;
ALTER TABLE "credit_memo_lines" ADD CONSTRAINT "credit_memo_lines_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT;

CREATE TABLE "credit_memo_applications" (
  "id" TEXT NOT NULL,
  "memoId" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "appliedAmount" DECIMAL(14,2) NOT NULL,
  "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "appliedById" TEXT NOT NULL,
  CONSTRAINT "credit_memo_applications_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "credit_memo_applications_memoId_invoiceId_key" ON "credit_memo_applications"("memoId", "invoiceId");
CREATE INDEX "credit_memo_applications_invoiceId_idx" ON "credit_memo_applications"("invoiceId");
ALTER TABLE "credit_memo_applications" ADD CONSTRAINT "credit_memo_applications_memoId_fkey" FOREIGN KEY ("memoId") REFERENCES "credit_memos"("id") ON DELETE CASCADE;
ALTER TABLE "credit_memo_applications" ADD CONSTRAINT "credit_memo_applications_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "ar_invoices"("id") ON DELETE CASCADE;

-- ─── vendor_credit_notes ──────────────────────────────────────────────

CREATE TABLE "vendor_credit_notes" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "branchId" TEXT,
  "noteNumber" TEXT NOT NULL,
  "vendorNoteRef" TEXT,
  "vendorId" TEXT NOT NULL,
  "noteDate" TIMESTAMP(3) NOT NULL,
  "postingDate" TIMESTAMP(3) NOT NULL,
  "reason" "VendorCreditNoteReason" NOT NULL DEFAULT 'OTHER',
  "reasonNotes" TEXT,
  "relatedBillId" TEXT,
  "subtotal" DECIMAL(14,2) NOT NULL,
  "vatAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "totalAmount" DECIMAL(14,2) NOT NULL,
  "appliedAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "unappliedAmount" DECIMAL(14,2) NOT NULL,
  "status" "VendorCreditNoteStatus" NOT NULL DEFAULT 'DRAFT',
  "description" TEXT,
  "notes" TEXT,
  "createdById" TEXT NOT NULL,
  "postedById" TEXT,
  "postedAt" TIMESTAMP(3),
  "voidedById" TEXT,
  "voidedAt" TIMESTAMP(3),
  "voidReason" TEXT,
  "journalEntryId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "vendor_credit_notes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "vendor_credit_notes_journalEntryId_key" ON "vendor_credit_notes"("journalEntryId");
CREATE UNIQUE INDEX "vendor_credit_notes_tenantId_noteNumber_key" ON "vendor_credit_notes"("tenantId", "noteNumber");
CREATE INDEX "vendor_credit_notes_tenantId_vendorId_status_idx" ON "vendor_credit_notes"("tenantId", "vendorId", "status");
CREATE INDEX "vendor_credit_notes_tenantId_postingDate_idx" ON "vendor_credit_notes"("tenantId", "postingDate");

ALTER TABLE "vendor_credit_notes" ADD CONSTRAINT "vendor_credit_notes_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE;
ALTER TABLE "vendor_credit_notes" ADD CONSTRAINT "vendor_credit_notes_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL;
ALTER TABLE "vendor_credit_notes" ADD CONSTRAINT "vendor_credit_notes_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE RESTRICT;
ALTER TABLE "vendor_credit_notes" ADD CONSTRAINT "vendor_credit_notes_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id") ON DELETE SET NULL;

CREATE TABLE "vendor_credit_note_lines" (
  "id" TEXT NOT NULL,
  "noteId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "description" TEXT,
  "quantity" DECIMAL(14,4) NOT NULL DEFAULT 1,
  "unitPrice" DECIMAL(14,2) NOT NULL,
  "taxAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "lineTotal" DECIMAL(14,2) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "vendor_credit_note_lines_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "vendor_credit_note_lines_noteId_idx" ON "vendor_credit_note_lines"("noteId");
ALTER TABLE "vendor_credit_note_lines" ADD CONSTRAINT "vendor_credit_note_lines_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "vendor_credit_notes"("id") ON DELETE CASCADE;
ALTER TABLE "vendor_credit_note_lines" ADD CONSTRAINT "vendor_credit_note_lines_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT;

CREATE TABLE "vendor_credit_note_applications" (
  "id" TEXT NOT NULL,
  "noteId" TEXT NOT NULL,
  "billId" TEXT NOT NULL,
  "appliedAmount" DECIMAL(14,2) NOT NULL,
  "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "appliedById" TEXT NOT NULL,
  CONSTRAINT "vendor_credit_note_applications_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "vendor_credit_note_applications_noteId_billId_key" ON "vendor_credit_note_applications"("noteId", "billId");
CREATE INDEX "vendor_credit_note_applications_billId_idx" ON "vendor_credit_note_applications"("billId");
ALTER TABLE "vendor_credit_note_applications" ADD CONSTRAINT "vendor_credit_note_applications_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "vendor_credit_notes"("id") ON DELETE CASCADE;
ALTER TABLE "vendor_credit_note_applications" ADD CONSTRAINT "vendor_credit_note_applications_billId_fkey" FOREIGN KEY ("billId") REFERENCES "ap_bills"("id") ON DELETE CASCADE;

-- ─── customer_advances ────────────────────────────────────────────────

CREATE TABLE "customer_advances" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "branchId" TEXT,
  "advanceNumber" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "advanceDate" TIMESTAMP(3) NOT NULL,
  "postingDate" TIMESTAMP(3) NOT NULL,
  "method" "PaymentMethod" NOT NULL,
  "reference" TEXT,
  "totalAmount" DECIMAL(14,2) NOT NULL,
  "appliedAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "unappliedAmount" DECIMAL(14,2) NOT NULL,
  "status" "AdvanceStatus" NOT NULL DEFAULT 'DRAFT',
  "description" TEXT,
  "notes" TEXT,
  "createdById" TEXT NOT NULL,
  "postedById" TEXT,
  "postedAt" TIMESTAMP(3),
  "voidedById" TEXT,
  "voidedAt" TIMESTAMP(3),
  "voidReason" TEXT,
  "journalEntryId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "customer_advances_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "customer_advances_journalEntryId_key" ON "customer_advances"("journalEntryId");
CREATE UNIQUE INDEX "customer_advances_tenantId_advanceNumber_key" ON "customer_advances"("tenantId", "advanceNumber");
CREATE INDEX "customer_advances_tenantId_customerId_status_idx" ON "customer_advances"("tenantId", "customerId", "status");
CREATE INDEX "customer_advances_tenantId_postingDate_idx" ON "customer_advances"("tenantId", "postingDate");

ALTER TABLE "customer_advances" ADD CONSTRAINT "customer_advances_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE;
ALTER TABLE "customer_advances" ADD CONSTRAINT "customer_advances_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL;
ALTER TABLE "customer_advances" ADD CONSTRAINT "customer_advances_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT;
ALTER TABLE "customer_advances" ADD CONSTRAINT "customer_advances_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id") ON DELETE SET NULL;

CREATE TABLE "customer_advance_applications" (
  "id" TEXT NOT NULL,
  "advanceId" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "appliedAmount" DECIMAL(14,2) NOT NULL,
  "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "appliedById" TEXT NOT NULL,
  CONSTRAINT "customer_advance_applications_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "customer_advance_applications_advanceId_invoiceId_key" ON "customer_advance_applications"("advanceId", "invoiceId");
CREATE INDEX "customer_advance_applications_invoiceId_idx" ON "customer_advance_applications"("invoiceId");
ALTER TABLE "customer_advance_applications" ADD CONSTRAINT "customer_advance_applications_advanceId_fkey" FOREIGN KEY ("advanceId") REFERENCES "customer_advances"("id") ON DELETE CASCADE;
ALTER TABLE "customer_advance_applications" ADD CONSTRAINT "customer_advance_applications_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "ar_invoices"("id") ON DELETE CASCADE;

-- ─── vendor_advances ──────────────────────────────────────────────────

CREATE TABLE "vendor_advances" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "branchId" TEXT,
  "advanceNumber" TEXT NOT NULL,
  "vendorId" TEXT NOT NULL,
  "advanceDate" TIMESTAMP(3) NOT NULL,
  "postingDate" TIMESTAMP(3) NOT NULL,
  "method" "PaymentMethod" NOT NULL,
  "reference" TEXT,
  "totalAmount" DECIMAL(14,2) NOT NULL,
  "appliedAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "unappliedAmount" DECIMAL(14,2) NOT NULL,
  "status" "AdvanceStatus" NOT NULL DEFAULT 'DRAFT',
  "description" TEXT,
  "notes" TEXT,
  "createdById" TEXT NOT NULL,
  "postedById" TEXT,
  "postedAt" TIMESTAMP(3),
  "voidedById" TEXT,
  "voidedAt" TIMESTAMP(3),
  "voidReason" TEXT,
  "journalEntryId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "vendor_advances_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "vendor_advances_journalEntryId_key" ON "vendor_advances"("journalEntryId");
CREATE UNIQUE INDEX "vendor_advances_tenantId_advanceNumber_key" ON "vendor_advances"("tenantId", "advanceNumber");
CREATE INDEX "vendor_advances_tenantId_vendorId_status_idx" ON "vendor_advances"("tenantId", "vendorId", "status");
CREATE INDEX "vendor_advances_tenantId_postingDate_idx" ON "vendor_advances"("tenantId", "postingDate");

ALTER TABLE "vendor_advances" ADD CONSTRAINT "vendor_advances_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE;
ALTER TABLE "vendor_advances" ADD CONSTRAINT "vendor_advances_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL;
ALTER TABLE "vendor_advances" ADD CONSTRAINT "vendor_advances_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE RESTRICT;
ALTER TABLE "vendor_advances" ADD CONSTRAINT "vendor_advances_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id") ON DELETE SET NULL;

CREATE TABLE "vendor_advance_applications" (
  "id" TEXT NOT NULL,
  "advanceId" TEXT NOT NULL,
  "billId" TEXT NOT NULL,
  "appliedAmount" DECIMAL(14,2) NOT NULL,
  "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "appliedById" TEXT NOT NULL,
  CONSTRAINT "vendor_advance_applications_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "vendor_advance_applications_advanceId_billId_key" ON "vendor_advance_applications"("advanceId", "billId");
CREATE INDEX "vendor_advance_applications_billId_idx" ON "vendor_advance_applications"("billId");
ALTER TABLE "vendor_advance_applications" ADD CONSTRAINT "vendor_advance_applications_advanceId_fkey" FOREIGN KEY ("advanceId") REFERENCES "vendor_advances"("id") ON DELETE CASCADE;
ALTER TABLE "vendor_advance_applications" ADD CONSTRAINT "vendor_advance_applications_billId_fkey" FOREIGN KEY ("billId") REFERENCES "ap_bills"("id") ON DELETE CASCADE;

-- ─── recurring_invoice_templates ──────────────────────────────────────

CREATE TABLE "recurring_invoice_templates" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "branchId" TEXT,
  "templateNumber" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "frequency" "RecurrenceFrequency" NOT NULL,
  "dayOfPeriod" INTEGER NOT NULL,
  "startDate" TIMESTAMP(3) NOT NULL,
  "endDate" TIMESTAMP(3),
  "termsDays" INTEGER NOT NULL DEFAULT 0,
  "nextRunAt" TIMESTAMP(3) NOT NULL,
  "lastRunAt" TIMESTAMP(3),
  "runCount" INTEGER NOT NULL DEFAULT 0,
  "subtotal" DECIMAL(14,2) NOT NULL,
  "vatAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "totalAmount" DECIMAL(14,2) NOT NULL,
  "status" "RecurringTemplateStatus" NOT NULL DEFAULT 'ACTIVE',
  "description" TEXT,
  "notes" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "recurring_invoice_templates_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "recurring_invoice_templates_tenantId_templateNumber_key" ON "recurring_invoice_templates"("tenantId", "templateNumber");
CREATE INDEX "recurring_invoice_templates_tenantId_customerId_status_idx" ON "recurring_invoice_templates"("tenantId", "customerId", "status");
CREATE INDEX "recurring_invoice_templates_tenantId_status_nextRunAt_idx" ON "recurring_invoice_templates"("tenantId", "status", "nextRunAt");

ALTER TABLE "recurring_invoice_templates" ADD CONSTRAINT "recurring_invoice_templates_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE;
ALTER TABLE "recurring_invoice_templates" ADD CONSTRAINT "recurring_invoice_templates_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL;
ALTER TABLE "recurring_invoice_templates" ADD CONSTRAINT "recurring_invoice_templates_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT;

CREATE TABLE "recurring_invoice_template_lines" (
  "id" TEXT NOT NULL,
  "templateId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "description" TEXT,
  "quantity" DECIMAL(14,4) NOT NULL DEFAULT 1,
  "unitPrice" DECIMAL(14,2) NOT NULL,
  "taxAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "lineTotal" DECIMAL(14,2) NOT NULL,
  CONSTRAINT "recurring_invoice_template_lines_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "recurring_invoice_template_lines_templateId_idx" ON "recurring_invoice_template_lines"("templateId");
ALTER TABLE "recurring_invoice_template_lines" ADD CONSTRAINT "recurring_invoice_template_lines_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "recurring_invoice_templates"("id") ON DELETE CASCADE;
ALTER TABLE "recurring_invoice_template_lines" ADD CONSTRAINT "recurring_invoice_template_lines_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT;

ALTER TABLE "ar_invoices" ADD CONSTRAINT "ar_invoices_recurringTemplateId_fkey" FOREIGN KEY ("recurringTemplateId") REFERENCES "recurring_invoice_templates"("id") ON DELETE SET NULL;

-- ─── recurring_bill_templates ─────────────────────────────────────────

CREATE TABLE "recurring_bill_templates" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "branchId" TEXT,
  "templateNumber" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "vendorId" TEXT NOT NULL,
  "frequency" "RecurrenceFrequency" NOT NULL,
  "dayOfPeriod" INTEGER NOT NULL,
  "startDate" TIMESTAMP(3) NOT NULL,
  "endDate" TIMESTAMP(3),
  "termsDays" INTEGER NOT NULL DEFAULT 0,
  "nextRunAt" TIMESTAMP(3) NOT NULL,
  "lastRunAt" TIMESTAMP(3),
  "runCount" INTEGER NOT NULL DEFAULT 0,
  "subtotal" DECIMAL(14,2) NOT NULL,
  "vatAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "whtAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "whtAtcCode" TEXT,
  "totalAmount" DECIMAL(14,2) NOT NULL,
  "status" "RecurringTemplateStatus" NOT NULL DEFAULT 'ACTIVE',
  "description" TEXT,
  "notes" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "recurring_bill_templates_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "recurring_bill_templates_tenantId_templateNumber_key" ON "recurring_bill_templates"("tenantId", "templateNumber");
CREATE INDEX "recurring_bill_templates_tenantId_vendorId_status_idx" ON "recurring_bill_templates"("tenantId", "vendorId", "status");
CREATE INDEX "recurring_bill_templates_tenantId_status_nextRunAt_idx" ON "recurring_bill_templates"("tenantId", "status", "nextRunAt");

ALTER TABLE "recurring_bill_templates" ADD CONSTRAINT "recurring_bill_templates_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE;
ALTER TABLE "recurring_bill_templates" ADD CONSTRAINT "recurring_bill_templates_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL;
ALTER TABLE "recurring_bill_templates" ADD CONSTRAINT "recurring_bill_templates_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE RESTRICT;

CREATE TABLE "recurring_bill_template_lines" (
  "id" TEXT NOT NULL,
  "templateId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "description" TEXT,
  "quantity" DECIMAL(14,4) NOT NULL DEFAULT 1,
  "unitPrice" DECIMAL(14,2) NOT NULL,
  "taxAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "lineTotal" DECIMAL(14,2) NOT NULL,
  CONSTRAINT "recurring_bill_template_lines_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "recurring_bill_template_lines_templateId_idx" ON "recurring_bill_template_lines"("templateId");
ALTER TABLE "recurring_bill_template_lines" ADD CONSTRAINT "recurring_bill_template_lines_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "recurring_bill_templates"("id") ON DELETE CASCADE;
ALTER TABLE "recurring_bill_template_lines" ADD CONSTRAINT "recurring_bill_template_lines_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT;

ALTER TABLE "ap_bills" ADD CONSTRAINT "ap_bills_recurringTemplateId_fkey" FOREIGN KEY ("recurringTemplateId") REFERENCES "recurring_bill_templates"("id") ON DELETE SET NULL;
