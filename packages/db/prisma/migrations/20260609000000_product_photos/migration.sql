-- Postgres BYTEA-backed photo storage for product images.
-- Lets the API persist uploaded photos in the existing Railway database so
-- they survive deploys without standing up R2 / S3.

CREATE TABLE "product_photos" (
  "id"           TEXT NOT NULL,
  "tenantId"     TEXT NOT NULL,
  "mimeType"     TEXT NOT NULL,
  "byteSize"     INTEGER NOT NULL,
  "data"         BYTEA NOT NULL,
  "originalName" TEXT,
  "createdById"  TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "productId"    TEXT,

  CONSTRAINT "product_photos_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "product_photos_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE,
  CONSTRAINT "product_photos_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL
);

CREATE INDEX "product_photos_tenantId_createdAt_idx"
  ON "product_photos"("tenantId", "createdAt");
