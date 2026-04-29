-- AR/AP Backbone — formal customer-invoice + vendor-bill data model with
-- payment matching, status tracking, and per-tenant document number sequences.
--
-- Additive only. Existing Customer / Vendor / Order / ExpenseEntry data stays.
-- POS Orders with invoiceType=CHARGE remain as-is; ARInvoice is a separate
-- document type for back-office invoicing.

-- ─── Enums ────────────────────────────────────────────────────────────────────

CREATE TYPE "InvoiceStatus" AS ENUM (
    'DRAFT',
    'OPEN',
    'PARTIALLY_PAID',
    'PAID',
    'CANCELLED',
    'VOIDED'
);

CREATE TYPE "BillStatus" AS ENUM (
    'DRAFT',
    'OPEN',
    'PARTIALLY_PAID',
    'PAID',
    'CANCELLED',
    'VOIDED'
);

CREATE TYPE "SequenceType" AS ENUM (
    'AR_INVOICE',
    'AR_PAYMENT',
    'AP_BILL',
    'AP_PAYMENT'
);

CREATE TYPE "SequenceResetPolicy" AS ENUM (
    'NEVER',
    'YEARLY',
    'MONTHLY'
);

-- ─── AR (Accounts Receivable) ────────────────────────────────────────────────

CREATE TABLE "ar_invoices" (
    "id"             TEXT             NOT NULL,
    "tenantId"       TEXT             NOT NULL,
    "branchId"       TEXT,
    "invoiceNumber"  TEXT             NOT NULL,
    "reference"      TEXT,
    "customerId"     TEXT             NOT NULL,
    "invoiceDate"    TIMESTAMP(3)     NOT NULL,
    "postingDate"    TIMESTAMP(3)     NOT NULL,
    "dueDate"        TIMESTAMP(3)     NOT NULL,
    "termsDays"      INTEGER          NOT NULL DEFAULT 0,
    "subtotal"       DECIMAL(14,2)    NOT NULL,
    "vatAmount"      DECIMAL(14,2)    NOT NULL DEFAULT 0,
    "totalAmount"    DECIMAL(14,2)    NOT NULL,
    "paidAmount"     DECIMAL(14,2)    NOT NULL DEFAULT 0,
    "balanceAmount"  DECIMAL(14,2)    NOT NULL,
    "status"         "InvoiceStatus"  NOT NULL DEFAULT 'DRAFT',
    "description"    TEXT,
    "notes"          TEXT,
    "createdById"    TEXT             NOT NULL,
    "postedById"     TEXT,
    "postedAt"       TIMESTAMP(3),
    "voidedById"     TEXT,
    "voidedAt"       TIMESTAMP(3),
    "voidReason"     TEXT,
    "journalEntryId" TEXT,
    "createdAt"      TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3)     NOT NULL,

    CONSTRAINT "ar_invoices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ar_invoices_tenantId_invoiceNumber_key" ON "ar_invoices"("tenantId", "invoiceNumber");
CREATE UNIQUE INDEX "ar_invoices_journalEntryId_key" ON "ar_invoices"("journalEntryId");
CREATE INDEX "ar_invoices_tenantId_customerId_status_idx" ON "ar_invoices"("tenantId", "customerId", "status");
CREATE INDEX "ar_invoices_tenantId_status_dueDate_idx" ON "ar_invoices"("tenantId", "status", "dueDate");
CREATE INDEX "ar_invoices_tenantId_postingDate_idx" ON "ar_invoices"("tenantId", "postingDate");

ALTER TABLE "ar_invoices" ADD CONSTRAINT "ar_invoices_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE;
ALTER TABLE "ar_invoices" ADD CONSTRAINT "ar_invoices_branchId_fkey"
    FOREIGN KEY ("branchId") REFERENCES "branches"("id");
ALTER TABLE "ar_invoices" ADD CONSTRAINT "ar_invoices_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "customers"("id");
ALTER TABLE "ar_invoices" ADD CONSTRAINT "ar_invoices_journalEntryId_fkey"
    FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id");

CREATE TABLE "ar_invoice_lines" (
    "id"          TEXT          NOT NULL,
    "invoiceId"   TEXT          NOT NULL,
    "accountId"   TEXT          NOT NULL,
    "description" TEXT,
    "quantity"    DECIMAL(14,4) NOT NULL DEFAULT 1,
    "unitPrice"   DECIMAL(14,2) NOT NULL,
    "taxAmount"   DECIMAL(14,2) NOT NULL DEFAULT 0,
    "lineTotal"   DECIMAL(14,2) NOT NULL,
    "createdAt"   TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ar_invoice_lines_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ar_invoice_lines_invoiceId_idx" ON "ar_invoice_lines"("invoiceId");

ALTER TABLE "ar_invoice_lines" ADD CONSTRAINT "ar_invoice_lines_invoiceId_fkey"
    FOREIGN KEY ("invoiceId") REFERENCES "ar_invoices"("id") ON DELETE CASCADE;
ALTER TABLE "ar_invoice_lines" ADD CONSTRAINT "ar_invoice_lines_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "accounts"("id");

CREATE TABLE "ar_payments" (
    "id"              TEXT             NOT NULL,
    "tenantId"        TEXT             NOT NULL,
    "branchId"        TEXT,
    "paymentNumber"   TEXT             NOT NULL,
    "customerId"      TEXT             NOT NULL,
    "paymentDate"     TIMESTAMP(3)     NOT NULL,
    "postingDate"     TIMESTAMP(3)     NOT NULL,
    "method"          "PaymentMethod"  NOT NULL,
    "reference"       TEXT,
    "totalAmount"     DECIMAL(14,2)    NOT NULL,
    "appliedAmount"   DECIMAL(14,2)    NOT NULL DEFAULT 0,
    "unappliedAmount" DECIMAL(14,2)    NOT NULL,
    "description"     TEXT,
    "notes"           TEXT,
    "createdById"     TEXT             NOT NULL,
    "voidedById"      TEXT,
    "voidedAt"        TIMESTAMP(3),
    "voidReason"      TEXT,
    "journalEntryId"  TEXT,
    "createdAt"       TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3)     NOT NULL,

    CONSTRAINT "ar_payments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ar_payments_tenantId_paymentNumber_key" ON "ar_payments"("tenantId", "paymentNumber");
CREATE UNIQUE INDEX "ar_payments_journalEntryId_key" ON "ar_payments"("journalEntryId");
CREATE INDEX "ar_payments_tenantId_customerId_idx" ON "ar_payments"("tenantId", "customerId");
CREATE INDEX "ar_payments_tenantId_postingDate_idx" ON "ar_payments"("tenantId", "postingDate");

ALTER TABLE "ar_payments" ADD CONSTRAINT "ar_payments_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE;
ALTER TABLE "ar_payments" ADD CONSTRAINT "ar_payments_branchId_fkey"
    FOREIGN KEY ("branchId") REFERENCES "branches"("id");
ALTER TABLE "ar_payments" ADD CONSTRAINT "ar_payments_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "customers"("id");
ALTER TABLE "ar_payments" ADD CONSTRAINT "ar_payments_journalEntryId_fkey"
    FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id");

CREATE TABLE "ar_payment_applications" (
    "id"            TEXT          NOT NULL,
    "paymentId"     TEXT          NOT NULL,
    "invoiceId"     TEXT          NOT NULL,
    "appliedAmount" DECIMAL(14,2) NOT NULL,
    "appliedAt"     TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ar_payment_applications_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ar_payment_applications_paymentId_invoiceId_key" ON "ar_payment_applications"("paymentId", "invoiceId");
CREATE INDEX "ar_payment_applications_invoiceId_idx" ON "ar_payment_applications"("invoiceId");

ALTER TABLE "ar_payment_applications" ADD CONSTRAINT "ar_payment_applications_paymentId_fkey"
    FOREIGN KEY ("paymentId") REFERENCES "ar_payments"("id") ON DELETE CASCADE;
ALTER TABLE "ar_payment_applications" ADD CONSTRAINT "ar_payment_applications_invoiceId_fkey"
    FOREIGN KEY ("invoiceId") REFERENCES "ar_invoices"("id") ON DELETE CASCADE;

-- ─── AP (Accounts Payable) ───────────────────────────────────────────────────

CREATE TABLE "ap_bills" (
    "id"             TEXT             NOT NULL,
    "tenantId"       TEXT             NOT NULL,
    "branchId"       TEXT,
    "billNumber"     TEXT             NOT NULL,
    "vendorBillRef"  TEXT,
    "reference"      TEXT,
    "vendorId"       TEXT             NOT NULL,
    "billDate"       TIMESTAMP(3)     NOT NULL,
    "postingDate"    TIMESTAMP(3)     NOT NULL,
    "dueDate"        TIMESTAMP(3)     NOT NULL,
    "termsDays"      INTEGER          NOT NULL DEFAULT 0,
    "subtotal"       DECIMAL(14,2)    NOT NULL,
    "vatAmount"      DECIMAL(14,2)    NOT NULL DEFAULT 0,
    "whtAmount"      DECIMAL(14,2)    NOT NULL DEFAULT 0,
    "whtAtcCode"     TEXT,
    "totalAmount"    DECIMAL(14,2)    NOT NULL,
    "paidAmount"     DECIMAL(14,2)    NOT NULL DEFAULT 0,
    "balanceAmount"  DECIMAL(14,2)    NOT NULL,
    "status"         "BillStatus"     NOT NULL DEFAULT 'DRAFT',
    "description"    TEXT,
    "notes"          TEXT,
    "createdById"    TEXT             NOT NULL,
    "postedById"     TEXT,
    "postedAt"       TIMESTAMP(3),
    "voidedById"     TEXT,
    "voidedAt"       TIMESTAMP(3),
    "voidReason"     TEXT,
    "journalEntryId" TEXT,
    "createdAt"      TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3)     NOT NULL,

    CONSTRAINT "ap_bills_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ap_bills_tenantId_billNumber_key" ON "ap_bills"("tenantId", "billNumber");
CREATE UNIQUE INDEX "ap_bills_journalEntryId_key" ON "ap_bills"("journalEntryId");
CREATE INDEX "ap_bills_tenantId_vendorId_status_idx" ON "ap_bills"("tenantId", "vendorId", "status");
CREATE INDEX "ap_bills_tenantId_status_dueDate_idx" ON "ap_bills"("tenantId", "status", "dueDate");
CREATE INDEX "ap_bills_tenantId_postingDate_idx" ON "ap_bills"("tenantId", "postingDate");

ALTER TABLE "ap_bills" ADD CONSTRAINT "ap_bills_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE;
ALTER TABLE "ap_bills" ADD CONSTRAINT "ap_bills_branchId_fkey"
    FOREIGN KEY ("branchId") REFERENCES "branches"("id");
ALTER TABLE "ap_bills" ADD CONSTRAINT "ap_bills_vendorId_fkey"
    FOREIGN KEY ("vendorId") REFERENCES "vendors"("id");
ALTER TABLE "ap_bills" ADD CONSTRAINT "ap_bills_journalEntryId_fkey"
    FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id");

CREATE TABLE "ap_bill_lines" (
    "id"          TEXT          NOT NULL,
    "billId"      TEXT          NOT NULL,
    "accountId"   TEXT          NOT NULL,
    "description" TEXT,
    "quantity"    DECIMAL(14,4) NOT NULL DEFAULT 1,
    "unitPrice"   DECIMAL(14,2) NOT NULL,
    "taxAmount"   DECIMAL(14,2) NOT NULL DEFAULT 0,
    "lineTotal"   DECIMAL(14,2) NOT NULL,
    "createdAt"   TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ap_bill_lines_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ap_bill_lines_billId_idx" ON "ap_bill_lines"("billId");

ALTER TABLE "ap_bill_lines" ADD CONSTRAINT "ap_bill_lines_billId_fkey"
    FOREIGN KEY ("billId") REFERENCES "ap_bills"("id") ON DELETE CASCADE;
ALTER TABLE "ap_bill_lines" ADD CONSTRAINT "ap_bill_lines_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "accounts"("id");

CREATE TABLE "ap_payments" (
    "id"              TEXT             NOT NULL,
    "tenantId"        TEXT             NOT NULL,
    "branchId"        TEXT,
    "paymentNumber"   TEXT             NOT NULL,
    "vendorId"        TEXT             NOT NULL,
    "paymentDate"     TIMESTAMP(3)     NOT NULL,
    "postingDate"     TIMESTAMP(3)     NOT NULL,
    "method"          "PaymentMethod"  NOT NULL,
    "reference"       TEXT,
    "totalAmount"     DECIMAL(14,2)    NOT NULL,
    "appliedAmount"   DECIMAL(14,2)    NOT NULL DEFAULT 0,
    "unappliedAmount" DECIMAL(14,2)    NOT NULL,
    "description"     TEXT,
    "notes"           TEXT,
    "createdById"     TEXT             NOT NULL,
    "voidedById"      TEXT,
    "voidedAt"        TIMESTAMP(3),
    "voidReason"      TEXT,
    "journalEntryId"  TEXT,
    "createdAt"       TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3)     NOT NULL,

    CONSTRAINT "ap_payments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ap_payments_tenantId_paymentNumber_key" ON "ap_payments"("tenantId", "paymentNumber");
CREATE UNIQUE INDEX "ap_payments_journalEntryId_key" ON "ap_payments"("journalEntryId");
CREATE INDEX "ap_payments_tenantId_vendorId_idx" ON "ap_payments"("tenantId", "vendorId");
CREATE INDEX "ap_payments_tenantId_postingDate_idx" ON "ap_payments"("tenantId", "postingDate");

ALTER TABLE "ap_payments" ADD CONSTRAINT "ap_payments_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE;
ALTER TABLE "ap_payments" ADD CONSTRAINT "ap_payments_branchId_fkey"
    FOREIGN KEY ("branchId") REFERENCES "branches"("id");
ALTER TABLE "ap_payments" ADD CONSTRAINT "ap_payments_vendorId_fkey"
    FOREIGN KEY ("vendorId") REFERENCES "vendors"("id");
ALTER TABLE "ap_payments" ADD CONSTRAINT "ap_payments_journalEntryId_fkey"
    FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id");

CREATE TABLE "ap_payment_applications" (
    "id"            TEXT          NOT NULL,
    "paymentId"     TEXT          NOT NULL,
    "billId"        TEXT          NOT NULL,
    "appliedAmount" DECIMAL(14,2) NOT NULL,
    "appliedAt"     TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ap_payment_applications_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ap_payment_applications_paymentId_billId_key" ON "ap_payment_applications"("paymentId", "billId");
CREATE INDEX "ap_payment_applications_billId_idx" ON "ap_payment_applications"("billId");

ALTER TABLE "ap_payment_applications" ADD CONSTRAINT "ap_payment_applications_paymentId_fkey"
    FOREIGN KEY ("paymentId") REFERENCES "ap_payments"("id") ON DELETE CASCADE;
ALTER TABLE "ap_payment_applications" ADD CONSTRAINT "ap_payment_applications_billId_fkey"
    FOREIGN KEY ("billId") REFERENCES "ap_bills"("id") ON DELETE CASCADE;

-- ─── Document Number Sequences ───────────────────────────────────────────────

CREATE TABLE "document_number_sequences" (
    "id"          TEXT                  NOT NULL,
    "tenantId"    TEXT                  NOT NULL,
    "type"        "SequenceType"        NOT NULL,
    "branchId"    TEXT,
    "prefix"      TEXT                  NOT NULL DEFAULT '',
    "format"      TEXT,
    "padding"     INTEGER               NOT NULL DEFAULT 4,
    "counter"     INTEGER               NOT NULL DEFAULT 0,
    "lastResetAt" TIMESTAMP(3),
    "resetPolicy" "SequenceResetPolicy" NOT NULL DEFAULT 'NEVER',
    "createdAt"   TIMESTAMP(3)          NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3)          NOT NULL,

    CONSTRAINT "document_number_sequences_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "document_number_sequences_tenantId_type_branchId_key"
    ON "document_number_sequences"("tenantId", "type", "branchId");

ALTER TABLE "document_number_sequences" ADD CONSTRAINT "document_number_sequences_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE;
