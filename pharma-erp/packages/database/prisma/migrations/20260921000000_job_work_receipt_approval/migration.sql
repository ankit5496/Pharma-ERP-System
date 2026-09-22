-- The inward receipt becomes a document that is assembled, submitted, and then
-- inspected.
--
-- TWO CHANGES, ONE IDEA. A receipt used to be booked complete and either
-- quarantined or not, decided by a checkbox at the moment of booking. It is now
-- a DRAFT that materials are added to, submitted for approval when the delivery
-- is fully recorded, and approved or rejected by a quality user. The checkbox is
-- gone; the status carries what it used to say.
--
-- THE CHALLAN MOVES TO THE LINE. One draft receipt per job-work order collects
-- materials that may arrive on several of the principal's challans, so the
-- challan number belongs to the material it came with, not to the document that
-- gathers them. Every existing line is backfilled from its own parent, so no
-- traceability is lost.
--
-- Existing receipts keep their numbers and their history. PENDING_QC becomes
-- PENDING_APPROVAL and RELEASED becomes APPROVED: the same two states under the
-- names the workflow now uses.

-- ---------------------------------------------------------------------------
-- 0. RLS is FORCEd on these tables, and that includes the owner running this
--    migration — the backfill below would silently touch zero rows otherwise.
--    Restored at the end, inside the one transaction Prisma wraps this in.
-- ---------------------------------------------------------------------------

ALTER TABLE "job_work_material_receipts" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "job_work_material_receipt_lines" DISABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 1. The status a receipt moves through.
--
--    A new type rather than added values: Postgres cannot drop an enum value,
--    and leaving PENDING_QC and RELEASED behind would leave two spellings of
--    each state for the next person to choose between.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'JobWorkReceiptStatus_new') THEN
    CREATE TYPE "JobWorkReceiptStatus_new" AS ENUM (
      'DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ON_HOLD', 'REJECTED'
    );
  END IF;
END
$$;

ALTER TABLE "job_work_material_receipts" ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "job_work_material_receipts"
  ALTER COLUMN "status" TYPE "JobWorkReceiptStatus_new"
  USING (
    CASE "status"::text
      -- Awaiting inspection under the old model; awaiting approval under the
      -- new one. The same material in the same place.
      WHEN 'PENDING_QC' THEN 'PENDING_APPROVAL'
      -- Cleared and issuable. "Approved" is what the workflow calls that now.
      WHEN 'RELEASED'   THEN 'APPROVED'
      WHEN 'ON_HOLD'    THEN 'ON_HOLD'
      WHEN 'REJECTED'   THEN 'REJECTED'
      ELSE 'APPROVED'
    END
  )::"JobWorkReceiptStatus_new";

DROP TYPE IF EXISTS "JobWorkReceiptStatus";
ALTER TYPE "JobWorkReceiptStatus_new" RENAME TO "JobWorkReceiptStatus";

-- A receipt now starts as something being assembled.
ALTER TABLE "job_work_material_receipts"
  ALTER COLUMN "status" SET DEFAULT 'DRAFT';

-- ---------------------------------------------------------------------------
-- 2. When it was submitted, and by whom.
-- ---------------------------------------------------------------------------

ALTER TABLE "job_work_material_receipts"
  ADD COLUMN IF NOT EXISTS "submitted_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "submitted_by_id" UUID,
  ADD COLUMN IF NOT EXISTS "decided_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "decided_by_id" UUID,
  ADD COLUMN IF NOT EXISTS "decision_notes" VARCHAR(1000);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'job_work_material_receipts_submitted_by_id_fkey'
  ) THEN
    ALTER TABLE "job_work_material_receipts"
      ADD CONSTRAINT "job_work_material_receipts_submitted_by_id_fkey"
      FOREIGN KEY ("submitted_by_id") REFERENCES "users"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'job_work_material_receipts_decided_by_id_fkey'
  ) THEN
    ALTER TABLE "job_work_material_receipts"
      ADD CONSTRAINT "job_work_material_receipts_decided_by_id_fkey"
      FOREIGN KEY ("decided_by_id") REFERENCES "users"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$$;

-- Receipts booked before this migration were submitted and decided in one act,
-- at the moment they were recorded. Attributing both to whoever recorded them,
-- at the time they did, is what actually happened.
UPDATE "job_work_material_receipts"
   SET "submitted_at" = COALESCE("submitted_at", "received_at"),
       "submitted_by_id" = COALESCE("submitted_by_id", "received_by_id")
 WHERE "status" <> 'DRAFT';

UPDATE "job_work_material_receipts"
   SET "decided_at" = COALESCE("decided_at", "received_at"),
       "decided_by_id" = COALESCE("decided_by_id", "received_by_id")
 WHERE "status" IN ('APPROVED', 'ON_HOLD', 'REJECTED');

-- ---------------------------------------------------------------------------
-- 3. The challan belongs to the material that arrived on it.
-- ---------------------------------------------------------------------------

ALTER TABLE "job_work_material_receipt_lines"
  ADD COLUMN IF NOT EXISTS "delivery_challan_number" VARCHAR(64);

UPDATE "job_work_material_receipt_lines" l
   SET "delivery_challan_number" = r."delivery_challan_number"
  FROM "job_work_material_receipts" r
 WHERE l."receipt_id" = r."id"
   AND l."delivery_challan_number" IS NULL;

-- Any line whose parent somehow had none: the column is NOT NULL on the parent,
-- so this is belt and braces rather than an expected case.
UPDATE "job_work_material_receipt_lines"
   SET "delivery_challan_number" = '—'
 WHERE "delivery_challan_number" IS NULL;

ALTER TABLE "job_work_material_receipt_lines"
  ALTER COLUMN "delivery_challan_number" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "job_work_material_receipt_lines_tenant_id_challan_idx"
  ON "job_work_material_receipt_lines" ("tenant_id", "delivery_challan_number");

ALTER TABLE "job_work_material_receipts"
  DROP COLUMN IF EXISTS "delivery_challan_number";

-- ---------------------------------------------------------------------------
-- 4. Row-level security, put back exactly as it was.
-- ---------------------------------------------------------------------------

ALTER TABLE "job_work_material_receipts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "job_work_material_receipts" FORCE ROW LEVEL SECURITY;
ALTER TABLE "job_work_material_receipt_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "job_work_material_receipt_lines" FORCE ROW LEVEL SECURITY;
