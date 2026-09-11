-- =============================================================================
-- Item: batch tracking and notes
-- =============================================================================
-- Both come from the Procure-to-Pay work, which defined its own `items` model
-- before the two branches met. That model never reached the database — the
-- master-data one got there first, so the live table has `type`,
-- PACKING_MATERIAL and a varchar `uom`, not `item_type`, PACKAGING and a
-- UnitOfMeasure enum.
--
-- Rather than keep two shapes, the merge kept one `items` table with the
-- master-data column names and folded in the two fields that only the
-- procurement side had. These are those two. Everything else their model
-- needed already exists under a different name, and their code was changed to
-- match.
--
-- Both are additive with defaults, so existing rows stay valid.
-- =============================================================================

ALTER TABLE "items"
  ADD COLUMN IF NOT EXISTS "requires_batch_tracking" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "notes" VARCHAR(1000);

-- Row-level security needs no change: policies attach to the table, not to
-- its columns, so items_tenant_isolation already covers both.
