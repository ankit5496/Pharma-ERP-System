-- =============================================================================
-- One consumption row per material PER LOT, not per material
-- =============================================================================
-- `20260929020000_batch_material_consumption` made the row unique on
-- (batch, item). That is wrong, and the live data says so: a material issued
-- against one work order is routinely drawn from more than one lot — a drum
-- runs out and the next is opened, which is exactly what FEFO does when the
-- nearest-expiry lot cannot cover the requirement on its own.
--
-- COLLAPSING THEM WOULD LOSE THE LOT. Summing two lots into one row means
-- storing one lot id and discarding the other, and the discarded one is
-- material that physically went into the batch. A recall reads this table to
-- answer "which batches contain lot X"; a row that names only the larger of two
-- lots answers it wrongly, and quietly.
--
-- So the grain is (batch, item, lot). The variance grid sums across lots, which
-- is what it did when it read the issue lines directly.
--
-- NULL LOTS. `lot_id` is nullable — packing material is not always lot-tracked
-- — and NULLs do not compare equal in a unique index, so two null-lot rows for
-- one material would both be allowed. COALESCE to the nil UUID inside the index
-- makes them collide as intended. The nil UUID is not a real lot id, so it
-- cannot collide with one.
-- =============================================================================

DROP INDEX IF EXISTS "batch_material_consumptions_batch_id_item_id_key";

CREATE UNIQUE INDEX "batch_material_consumptions_batch_id_item_id_lot_id_key"
  ON "batch_material_consumptions" (
    "batch_id",
    "item_id",
    (COALESCE("lot_id", '00000000-0000-0000-0000-000000000000'::uuid))
  );

-- The non-unique index the schema now declares in the dropped one's place.
-- "What did this batch consume" is the read the variance grid makes, and it no
-- longer has a unique index on the same columns to serve it.
CREATE INDEX IF NOT EXISTS "batch_material_consumptions_batch_id_item_id_idx"
  ON "batch_material_consumptions" ("batch_id", "item_id");
