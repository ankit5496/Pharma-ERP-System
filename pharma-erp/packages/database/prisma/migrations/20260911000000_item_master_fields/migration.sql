-- =============================================================================
-- Item master: the commercial and regulatory fields
-- =============================================================================
-- The items table was created for manufacture — enough to dispense a material
-- and date a batch. Selling one needs more: what schedule it falls under, what
-- tax it attracts, what it may be priced at.
--
-- Every new column is NULLABLE or carries a DEFAULT, so the rows already in
-- the table stay valid. Where a field is genuinely required — HSN and GST
-- cannot be left out of an invoice — the requirement is enforced by the create
-- endpoint rather than by the column, because making the column NOT NULL would
-- mean inventing values for existing rows, and an invented HSN code is worse
-- than a missing one.
-- =============================================================================

-- AlterEnum
-- Bulk that has been made but not packed. Placed before FINISHED_GOOD so the
-- enum reads in process order. Permitted inside a transaction on PostgreSQL 12
-- and later, provided the new value is not USED in the same transaction — it
-- is not, so this is safe here.
ALTER TYPE "ItemType" ADD VALUE 'SEMI_FINISHED' BEFORE 'FINISHED_GOOD';

-- CreateEnum
CREATE TYPE "ScheduleClassification" AS ENUM ('NONE', 'H', 'H1', 'X', 'G');

-- AlterTable
ALTER TABLE "items"
  ADD COLUMN "brand_name" VARCHAR(255),
  ADD COLUMN "generic_name" VARCHAR(512),
  ADD COLUMN "schedule_classification" "ScheduleClassification" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "gst_rate" DECIMAL(5,2),
  ADD COLUMN "mrp" DECIMAL(12,2),
  ADD COLUMN "dpco_ceiling" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "storage_conditions" VARCHAR(255),
  ADD COLUMN "reorder_level" DECIMAL(14,3),
  ADD COLUMN "reorder_quantity" DECIMAL(14,3);

-- -----------------------------------------------------------------------------
-- Invariants
-- -----------------------------------------------------------------------------
-- All of these pass trivially for existing rows, where every new column is
-- NULL — a CHECK is satisfied by NULL, not violated by it. They bite only on
-- what is written from here on.

ALTER TABLE "items"
  ADD CONSTRAINT "items_gst_rate_is_a_percentage"
  CHECK ("gst_rate" IS NULL OR ("gst_rate" >= 0 AND "gst_rate" <= 100));

ALTER TABLE "items"
  ADD CONSTRAINT "items_mrp_positive"
  CHECK ("mrp" IS NULL OR "mrp" > 0);

ALTER TABLE "items"
  ADD CONSTRAINT "items_reorder_level_non_negative"
  CHECK ("reorder_level" IS NULL OR "reorder_level" >= 0);

ALTER TABLE "items"
  ADD CONSTRAINT "items_reorder_quantity_positive"
  CHECK ("reorder_quantity" IS NULL OR "reorder_quantity" > 0);

-- Shelf life is what batch expiry is computed from, so zero or a negative
-- would date a batch as expiring on or before the day it was made.
ALTER TABLE "items"
  ADD CONSTRAINT "items_shelf_life_positive"
  CHECK ("shelf_life_months" IS NULL OR "shelf_life_months" > 0);

-- A DPCO ceiling applies to a price, so flagging one without an MRP records a
-- restriction on a number that does not exist.
ALTER TABLE "items"
  ADD CONSTRAINT "items_dpco_ceiling_needs_a_price"
  CHECK (NOT "dpco_ceiling" OR "mrp" IS NOT NULL);

-- Row-level security needs no change: policies attach to the table, not to its
-- columns, so items_tenant_isolation already covers everything added above.
