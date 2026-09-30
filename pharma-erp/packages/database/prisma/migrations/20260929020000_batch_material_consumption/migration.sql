-- =============================================================================
-- US-PROD-03: what each material actually went into the batch
-- =============================================================================
-- "Actual quantities consumed versus planned, so that yield and wastage are
-- captured for every batch."
--
-- THE GAP THIS CLOSES. The batch record already holds `actual_quantity` — one
-- figure, the finished yield — and the variance grid compared the formulation
-- against what the FEFO run ISSUED. Issued is not consumed: material is
-- returned to store, spilt, or a drum is opened and only part of it used. The
-- record said "we gave the floor 0.8 KG", which is not the same claim as "0.8
-- KG went into the batch", and the second is the one a recall or a yield
-- investigation actually asks about.
--
-- MODELLED LIKE `batch_packaging_consumptions`, which records the same thing on
-- the packing side and arrived first. One row per material per batch, the
-- quantity, and the lot it came out of. Two tables rather than one because a
-- packing consumption hangs off the PACKING RECORD and this hangs off the
-- BATCH: they are recorded at different moments by different people, and a
-- shared table would need a nullable half that is always wrong for one of them.
--
-- EVERY COLUMN IS OPTIONAL TO POPULATE, in the sense that a batch with no rows
-- here is legitimate: batches recorded before this existed have none, and the
-- variance grid falls back to the issued figure for those. What is NOT allowed
-- is a row claiming a negative quantity or two rows for one material.
-- =============================================================================

CREATE TABLE "batch_material_consumptions" (
  "id"        UUID NOT NULL,
  "tenant_id" UUID NOT NULL,

  "batch_id" UUID NOT NULL,

  -- The raw material. An Item of type RAW_MATERIAL, checked by the service — a
  -- CHECK constraint cannot read another table.
  "item_id" UUID NOT NULL,

  "quantity_consumed" DECIMAL(14, 3) NOT NULL,

  -- The lot it came out of, where one was recorded. Nullable for the same
  -- reason the packing table's is: a consumption that cannot name its lot is
  -- still worth more than no record of the consumption.
  "lot_id" UUID,

  "notes" VARCHAR(255),

  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "batch_material_consumptions_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "batch_material_consumptions"
  ADD CONSTRAINT "batch_material_consumptions_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CASCADE from the batch, matching the packing table: a consumption has no
-- meaning apart from the batch that consumed it.
ALTER TABLE "batch_material_consumptions"
  ADD CONSTRAINT "batch_material_consumptions_batch_id_fkey"
  FOREIGN KEY ("batch_id") REFERENCES "batches" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "batch_material_consumptions"
  ADD CONSTRAINT "batch_material_consumptions_item_id_fkey"
  FOREIGN KEY ("item_id") REFERENCES "items" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RESTRICT: a lot named on a batch record is part of that batch's trail, and a
-- recall reads it. The lot is soft-deleted anyway.
ALTER TABLE "batch_material_consumptions"
  ADD CONSTRAINT "batch_material_consumptions_lot_id_fkey"
  FOREIGN KEY ("lot_id") REFERENCES "stock_lots" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Zero is allowed and negative is not. Zero says "this material was issued and
-- none of it went in", which is a real and interesting claim; below zero is
-- arithmetic nobody can act on.
ALTER TABLE "batch_material_consumptions"
  ADD CONSTRAINT "batch_material_consumptions_quantity_not_negative"
  CHECK ("quantity_consumed" >= 0);

-- One line per material per batch. The same material twice is two answers to
-- one question, and the variance grid would double-count it.
CREATE UNIQUE INDEX "batch_material_consumptions_batch_id_item_id_key"
  ON "batch_material_consumptions" ("batch_id", "item_id");

-- The reverse question a recall asks: which batches consumed this material?
CREATE INDEX "batch_material_consumptions_tenant_id_item_id_idx"
  ON "batch_material_consumptions" ("tenant_id", "item_id");

-- ---------------------------------------------------------------------------
-- Tenant isolation, in the shape every other table here uses
-- ---------------------------------------------------------------------------
-- FORCE so it applies to the table owner too. USING reads through
-- `current_tenant_id()`, which returns null outside a tenant context and so
-- matches nothing; WITH CHECK writes through `require_tenant_id()`, which
-- RAISES. Reading outside a tenant finds nothing; WRITING outside one would
-- file a row under no tenant at all.

ALTER TABLE "batch_material_consumptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "batch_material_consumptions" FORCE ROW LEVEL SECURITY;

DO $rls$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'batch_material_consumptions'
      AND policyname = 'batch_material_consumptions_tenant_isolation'
  ) THEN
    CREATE POLICY "batch_material_consumptions_tenant_isolation"
      ON "batch_material_consumptions" FOR ALL
      USING ("tenant_id" = public.current_tenant_id())
      WITH CHECK ("tenant_id" = public.require_tenant_id());
  END IF;
END
$rls$;

-- The runtime role, which is NOT the owner: without this the application can
-- see the table and touch nothing in it.
--
-- DELETE included, matching batch_packaging_consumptions: re-recording a batch
-- replaces its consumption set, and a line removed in a correction should go
-- rather than linger as a figure nobody meant.
DO $grants$
DECLARE
  v_role text := 'pharma_app';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
    RAISE NOTICE 'Role % not present; skipping runtime grants.', v_role;
    RETURN;
  END IF;

  EXECUTE format(
    'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I TO %I',
    'batch_material_consumptions', v_role
  );
END
$grants$;
