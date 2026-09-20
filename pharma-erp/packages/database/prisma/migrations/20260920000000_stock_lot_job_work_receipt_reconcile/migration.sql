-- =============================================================================
-- stock_lots.job_work_material_receipt_id — restoring a dropped column
-- =============================================================================
-- `20260917000000_job_work_execution` adds this column, a foreign key to
-- `job_work_material_receipts`, and a unique index on it. That migration is
-- recorded in `_prisma_migrations` as finished, `prisma migrate status` reports
-- the schema up to date, and the column is not there.
--
-- IT WAS THERE ONCE. The `stock_lots_has_one_source` CHECK from the same
-- migration NAMES this column and is still present, and Postgres cannot create
-- that constraint against a column that does not exist — so the column was
-- created, the CHECK was built on it, and the column was dropped afterwards.
-- A `DROP COLUMN ... CASCADE` would explain it: cascade removes the dependent
-- foreign key and unique index silently, which is exactly the set that is
-- missing, but leaves a table-level CHECK behind when Postgres can still parse
-- it. Whatever did it, the recorded migration history no longer describes the
-- database.
--
-- The symptom is a 500 on Production & Quality Gate -> Material issue. The
-- generated client names every column in its SELECTs, so EVERY read of
-- `stock_lots` fails with
--
--     The column `stock_lots.job_work_material_receipt_id` does not exist
--
-- and that table is read by the material-issue panel, the stock ledger and the
-- incoming-QC screens alike.
--
-- IDEMPOTENT. Every statement is guarded, so a fresh database built from the
-- full history — where the original migration did take — is untouched.
--
-- NO BACKFILL, and none is possible: the column is nullable and records which
-- job-work receipt a principal-owned lot arrived on. A company-owned lot has
-- none by definition, and the link for any principal-owned lot was lost with
-- the column. `stock_lots` is empty on this database, so nothing is owed.
-- =============================================================================

ALTER TABLE "stock_lots"
  ADD COLUMN IF NOT EXISTS "job_work_material_receipt_id" UUID;

-- Recreated with the column. Cascade takes the foreign key and the unique index
-- when a column is dropped, which is why both are missing rather than one.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'stock_lots_job_work_material_receipt_id_fkey'
  ) THEN
    ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_job_work_material_receipt_id_fkey"
      FOREIGN KEY ("job_work_material_receipt_id") REFERENCES "job_work_material_receipts"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$$;

-- One lot per receipt: a principal's delivery becomes exactly one stock lot.
CREATE UNIQUE INDEX IF NOT EXISTS "stock_lots_job_work_material_receipt_id_key"
  ON "stock_lots"("job_work_material_receipt_id");

-- `stock_lots_has_one_source` is deliberately NOT recreated here: it survived
-- the drop and is still enforcing that a lot has exactly one source that agrees
-- with its ownership tag. Adding it again would fail on the duplicate name.
