-- Item-level refund (partial void) — alternative to full-order void.
-- Adds a running refundedQty counter to each line + an audit table for
-- per-event details. Inventory restock + proportional GL reversal are
-- handled in apps/api/src/orders/refund logic.

ALTER TABLE "order_items" ADD COLUMN "refundedQty" DECIMAL(12,4) NOT NULL DEFAULT 0;

CREATE TABLE "order_item_refunds" (
  "id"           TEXT NOT NULL,
  "orderItemId"  TEXT NOT NULL,
  "quantity"     DECIMAL(12,4) NOT NULL,
  "refundAmount" DECIMAL(12,2) NOT NULL,
  "reason"       TEXT NOT NULL,
  "refundMethod" "PaymentMethod" NOT NULL,
  "restocked"    BOOLEAN NOT NULL DEFAULT true,
  "refundedById" TEXT NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "order_item_refunds_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "order_item_refunds_orderItemId_fkey"  FOREIGN KEY ("orderItemId")  REFERENCES "order_items"("id") ON DELETE CASCADE,
  CONSTRAINT "order_item_refunds_refundedById_fkey" FOREIGN KEY ("refundedById") REFERENCES "users"("id")
);
CREATE INDEX "order_item_refunds_orderItemId_createdAt_idx" ON "order_item_refunds" ("orderItemId", "createdAt");
