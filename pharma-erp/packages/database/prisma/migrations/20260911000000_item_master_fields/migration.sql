-- =============================================================================
-- Item master: pharmaceutical and commercial fields
-- =============================================================================
-- RECONSTRUCTED FROM THE LIVE DATABASE — see the header of
-- 20260910152116_master_data_registers for why, and for the caveats.
--
-- The split between that migration and this one was inferred from column
-- ordinal position on the live table: everything below `deleted_at` was added
-- by a later ALTER, and `deleted_at` is last in every other model in this
-- schema. That is a reliable signal, not a guess — Postgres appends added
-- columns — but if the original file turns up, prefer it over this.
--
-- What these columns are for, since the names alone do not say:
--
--   schedule_classification — Drugs and Cosmetics Rules schedule (H, H1, X).
--       Decides prescription and record-keeping obligations; Schedule H1 in
--       particular requires a separate register of supply.
--   dpco_ceiling            — the product is under a DPCO price ceiling, so
--       MRP is capped by order rather than chosen.
--   gst_rate                — GST percentage for this item. Held on the item
--       alongside hsn_code rather than in a separate tax table, which is why
--       Procure-to-Pay reads tax from here.
-- =============================================================================

CREATE TYPE "ScheduleClassification" AS ENUM ('NONE', 'H', 'H1', 'X', 'G');

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
