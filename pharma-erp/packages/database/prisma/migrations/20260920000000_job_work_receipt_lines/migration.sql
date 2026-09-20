-- A principal's delivery becomes a document with materials on it.
--
-- Every existing receipt row is one material. It keeps its identity: the row
-- stays put as the HEADER (same id, same receipt number, same challan, same
-- audit trail), and its material columns are copied down into a single line
-- under it. Nothing is deleted, nothing is renumbered, and every stock lot
-- follows its material onto the line that now owns it.
--
-- Receipts booked before this migration were usable on arrival -- there was no
-- incoming-QC step for principal material -- so they are backfilled as
-- qc_required = false, status RELEASED. That is what actually happened to them;
-- marking them as having passed an inspection that never ran would be a lie in
-- the quality record.

-- ---------------------------------------------------------------------------
-- 0. Row-level security is FORCEd on these tables, and that includes the
--    owner running this migration.
--
--    Every data statement below -- the receipt_date backfill, the line INSERT,
--    the stock_lots repoint -- reads or writes rows across all tenants with no
--    app.current_tenant_id set, so under FORCE RLS each would silently match
--    ZERO rows and the migration would appear to succeed having moved nothing.
--    DDL is not filtered, so the NOT NULL would then fail on the rows the
--    backfill never saw, which is exactly how this was caught.
--
--    Disabled for the data moves and re-enabled at the end, inside the one
--    transaction Prisma wraps this migration in: there is no window in which
--    the tables are reachable with the policy off.
-- ---------------------------------------------------------------------------

ALTER TABLE "job_work_material_receipts" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "stock_lots" DISABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 1. Where a consignment stands.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'JobWorkReceiptStatus') THEN
    CREATE TYPE "JobWorkReceiptStatus" AS ENUM ('PENDING_QC', 'RELEASED', 'ON_HOLD', 'REJECTED');
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 2. The header gains what belongs to the delivery.
-- ---------------------------------------------------------------------------

-- The backfill runs ONLY when the columns are newly added. Re-running this
-- migration must not reset a consignment that has since been inspected --
-- an unconditional UPDATE here would quietly release held material.
DO $hdr$
DECLARE
  v_fresh boolean := NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'job_work_material_receipts'
      AND column_name = 'qc_required'
  );
BEGIN
  ALTER TABLE "job_work_material_receipts"
    ADD COLUMN IF NOT EXISTS "receipt_date" DATE,
    ADD COLUMN IF NOT EXISTS "qc_required" BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS "status" "JobWorkReceiptStatus" NOT NULL DEFAULT 'RELEASED';

  -- The date on the challan. For rows that predate the column, the day the
  -- receipt was keyed in is the best record we have of it.
  UPDATE "job_work_material_receipts"
     SET "receipt_date" = "received_at"::date
   WHERE "receipt_date" IS NULL;

  ALTER TABLE "job_work_material_receipts"
    ALTER COLUMN "receipt_date" SET NOT NULL;

  IF v_fresh THEN
    -- Booked under the old rules: usable on arrival, because no incoming-QC
    -- step existed for principal material. Recording them as having passed an
    -- inspection that never ran would be a lie in the quality record.
    UPDATE "job_work_material_receipts"
       SET "qc_required" = FALSE,
           "status" = 'RELEASED';
  END IF;
END
$hdr$;

-- ---------------------------------------------------------------------------
-- 3. The line that carries a material.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "job_work_material_receipt_lines" (
  "id"                 UUID           NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"          UUID           NOT NULL,
  "receipt_id"         UUID           NOT NULL,
  "item_id"            UUID           NOT NULL,
  "batch_number"       VARCHAR(64)    NOT NULL,
  "received_quantity"  DECIMAL(18, 4) NOT NULL,
  "manufacturing_date" DATE,
  "expiry_date"        DATE,
  "notes"              VARCHAR(500),
  "created_at"         TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"         TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at"         TIMESTAMPTZ(6),

  CONSTRAINT "job_work_material_receipt_lines_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'job_work_material_receipt_lines_tenant_id_fkey'
  ) THEN
    ALTER TABLE "job_work_material_receipt_lines"
      ADD CONSTRAINT "job_work_material_receipt_lines_tenant_id_fkey"
      FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'job_work_material_receipt_lines_receipt_id_fkey'
  ) THEN
    ALTER TABLE "job_work_material_receipt_lines"
      ADD CONSTRAINT "job_work_material_receipt_lines_receipt_id_fkey"
      FOREIGN KEY ("receipt_id") REFERENCES "job_work_material_receipts"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'job_work_material_receipt_lines_item_id_fkey'
  ) THEN
    ALTER TABLE "job_work_material_receipt_lines"
      ADD CONSTRAINT "job_work_material_receipt_lines_item_id_fkey"
      FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "job_work_material_receipt_lines_tenant_id_receipt_id_idx"
  ON "job_work_material_receipt_lines" ("tenant_id", "receipt_id");

CREATE INDEX IF NOT EXISTS "job_work_material_receipt_lines_tenant_id_item_id_idx"
  ON "job_work_material_receipt_lines" ("tenant_id", "item_id");

-- ---------------------------------------------------------------------------
-- 4. Every existing receipt's material moves down onto a line.
--
-- The line takes the receipt's own id, so the mapping is total, obvious and
-- re-runnable: one header, one line, and the lot below can find its line by
-- the id it already holds.
-- ---------------------------------------------------------------------------

INSERT INTO "job_work_material_receipt_lines" (
  "id", "tenant_id", "receipt_id", "item_id", "batch_number", "received_quantity",
  "manufacturing_date", "expiry_date", "notes", "created_at", "updated_at", "deleted_at"
)
SELECT
  r."id", r."tenant_id", r."id", r."item_id", r."batch_number", r."received_quantity",
  r."manufacturing_date", r."expiry_date", r."notes", r."created_at", r."updated_at", r."deleted_at"
FROM "job_work_material_receipts" r
WHERE NOT EXISTS (
  SELECT 1 FROM "job_work_material_receipt_lines" l WHERE l."receipt_id" = r."id"
);

-- ---------------------------------------------------------------------------
-- 5. The lot follows its material onto the line.
-- ---------------------------------------------------------------------------

ALTER TABLE "stock_lots"
  ADD COLUMN IF NOT EXISTS "job_work_material_receipt_line_id" UUID;

UPDATE "stock_lots"
   SET "job_work_material_receipt_line_id" = "job_work_material_receipt_id"
 WHERE "job_work_material_receipt_id" IS NOT NULL
   AND "job_work_material_receipt_line_id" IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'stock_lots_job_work_material_receipt_line_id_key'
  ) THEN
    ALTER TABLE "stock_lots"
      ADD CONSTRAINT "stock_lots_job_work_material_receipt_line_id_key"
      UNIQUE ("job_work_material_receipt_line_id");
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'stock_lots_job_work_material_receipt_line_id_fkey'
  ) THEN
    ALTER TABLE "stock_lots"
      ADD CONSTRAINT "stock_lots_job_work_material_receipt_line_id_fkey"
      FOREIGN KEY ("job_work_material_receipt_line_id")
      REFERENCES "job_work_material_receipt_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$$;

-- The either/or that keeps the two stock buckets structurally apart, restated
-- against the line. Dropped and recreated rather than edited: a CHECK cannot be
-- altered in place, and leaving the old one would forbid every new lot.
ALTER TABLE "stock_lots" DROP CONSTRAINT IF EXISTS "stock_lots_has_one_source";

ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_has_one_source"
  CHECK (
    ("ownership" = 'COMPANY_OWNED'
      AND "goods_receipt_line_id" IS NOT NULL
      AND "job_work_material_receipt_line_id" IS NULL)
    OR
    ("ownership" = 'PRINCIPAL_OWNED'
      AND "job_work_material_receipt_line_id" IS NOT NULL
      AND "goods_receipt_line_id" IS NULL)
  );

-- ---------------------------------------------------------------------------
-- 6. The header's material columns are gone; the line holds them now.
-- ---------------------------------------------------------------------------

ALTER TABLE "stock_lots"
  DROP COLUMN IF EXISTS "job_work_material_receipt_id";

ALTER TABLE "job_work_material_receipts"
  DROP COLUMN IF EXISTS "item_id",
  DROP COLUMN IF EXISTS "batch_number",
  DROP COLUMN IF EXISTS "received_quantity",
  DROP COLUMN IF EXISTS "manufacturing_date",
  DROP COLUMN IF EXISTS "expiry_date";

CREATE INDEX IF NOT EXISTS "job_work_material_receipts_tenant_id_status_idx"
  ON "job_work_material_receipts" ("tenant_id", "status");

-- ---------------------------------------------------------------------------
-- 7. The new table is tenant-scoped like every other, or it is a data leak.
--
-- ENABLE puts the policy on; FORCE applies it to the table owner too, so a
-- mistake in a migration or a console session cannot read across companies.
-- ---------------------------------------------------------------------------

-- The two tables whose policy was lifted for the data moves, put back exactly
-- as they were, plus the new table with the same treatment.
ALTER TABLE "job_work_material_receipts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "job_work_material_receipts" FORCE ROW LEVEL SECURITY;
ALTER TABLE "stock_lots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stock_lots" FORCE ROW LEVEL SECURITY;
ALTER TABLE "job_work_material_receipt_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "job_work_material_receipt_lines" FORCE ROW LEVEL SECURITY;

DO $rls$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'job_work_material_receipt_lines'
      AND policyname = 'job_work_material_receipt_lines_tenant_isolation'
  ) THEN
    CREATE POLICY "job_work_material_receipt_lines_tenant_isolation"
      ON "job_work_material_receipt_lines" FOR ALL
      USING ("tenant_id" = public.current_tenant_id())
      WITH CHECK ("tenant_id" = public.require_tenant_id());
  END IF;
END
$rls$;

-- ---------------------------------------------------------------------------
-- 8. No hard deletes. A line is what a principal says they sent us.
-- ---------------------------------------------------------------------------

DO $del$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'job_work_material_receipt_lines'::regclass
      AND tgname = 'job_work_material_receipt_lines_no_hard_delete'
  ) THEN
    CREATE TRIGGER "job_work_material_receipt_lines_no_hard_delete"
      BEFORE DELETE ON "job_work_material_receipt_lines"
      FOR EACH ROW EXECUTE FUNCTION public.prevent_hard_delete();
  END IF;
END
$del$;

-- ---------------------------------------------------------------------------
-- 9. Privileges for the runtime role, a no-op where it does not exist yet.
-- ---------------------------------------------------------------------------

DO $grants$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pharma_app') THEN
    RAISE NOTICE 'Role pharma_app not present; skipping runtime grants.';
    RETURN;
  END IF;

  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "job_work_material_receipt_lines" TO "pharma_app";
END
$grants$;
