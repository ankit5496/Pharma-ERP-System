-- =============================================================================
-- Reconciling three columns the hosted database never got
-- =============================================================================
-- `20260911120000_procure_to_pay` CREATEs `goods_receipt_lines` with
-- `quantity_rejected`, `storage_location` and `remarks`, and `stock_lots` with
-- `storage_location`. It is recorded in `_prisma_migrations` as applied, and
-- `prisma migrate status` reports the schema up to date -- but none of those
-- four columns are on the hosted database. Whatever produced those two tables
-- there, it was not the CREATE TABLE in that file.
--
-- So `schema.prisma` and the generated client both believe the columns exist.
-- The client names every column explicitly in its SELECTs, which means the
-- failure is not subtle and not partial: EVERY read of either table errors with
--
--     The column `stock_lots.storage_location` does not exist
--
-- The symptom was a 500 on Production & Quality Gate -> Material issue, whose
-- panel reads /production/stock-lots. Procure-to-Pay's goods-receipt and
-- stock-ledger screens read the other table and fail the same way.
--
-- IDEMPOTENT, via IF NOT EXISTS on every statement. A database that already
-- has these -- a fresh one built from the migration history, or the hosted one
-- once this has run -- is left untouched, which is what lets the two stop
-- disagreeing without a second migration to undo this one.
--
-- NO BACKFILL, and none is owed. All four columns are optional: three are
-- nullable and mean "not recorded", and `quantity_rejected` takes the same
-- DEFAULT 0 the original CREATE gave it, which is the correct value for every
-- existing row -- a line that was never gate-rejected had nothing rejected.
-- =============================================================================

-- Damaged or short-shipped at the gate, refused before QC sees it.
ALTER TABLE "goods_receipt_lines"
  ADD COLUMN IF NOT EXISTS "quantity_rejected" DECIMAL(18,4) NOT NULL DEFAULT 0;

ALTER TABLE "goods_receipt_lines"
  ADD COLUMN IF NOT EXISTS "storage_location" VARCHAR(128);

ALTER TABLE "goods_receipt_lines"
  ADD COLUMN IF NOT EXISTS "remarks" VARCHAR(1000);

-- Where the lot is physically held.
ALTER TABLE "stock_lots"
  ADD COLUMN IF NOT EXISTS "storage_location" VARCHAR(128);
