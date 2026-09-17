-- =============================================================================
-- Production reads real stock, and the Production stories get their invariants
-- =============================================================================
-- Corrects the Production & Quality Gate module against US-PROD-01 to -05.
--
-- THE CENTRAL CHANGE: material issue now allocates from `stock_lots`.
--
-- Two stock tables were modelled independently — `stock_lots` by
-- Procure-to-Pay and `material_lots` by Production — and only one of them is
-- ever filled by the application. A goods receipt creates a StockLot and
-- incoming QC marks it USABLE; nothing in any request path has ever written a
-- MaterialLot. The rows that exist locally came from
-- scripts/seed-production-demo.mjs, which is a demo seeder.
--
-- So the FEFO allocator in MaterialIssueService was correct code pointed at a
-- table the warehouse never puts anything into, and the availability check
-- US-PROD-01 asks for would have refused every work order ever raised. One
-- table, and it is the one a receipt actually lands in.
--
-- `material_lots` is left in place, not dropped. Dropping it belongs in its own
-- migration once the demo seeder is repointed and nothing reads it — a table
-- that is merely unused is harmless, and a DROP that turns out to be premature
-- is not.
--
-- What each story gets:
--
--   US-PROD-01  the availability check itself is in ProductionService; nothing
--               schema-level is needed beyond this file making the stock real.
--   US-PROD-02  is_fefo_override + override_reason, with a CHECK that a
--               reasonless override cannot be stored.
--   US-PROD-03  tenants.batch_number_prefix, so the convention is the
--               company's; the counter moves onto document_sequences in the
--               service, where an atomic increment replaces a read-then-write.
--   US-PROD-04  rejected_quantity and pack_variant on the packing record, and
--               batch_packaging_consumptions for what the pack actually used.
--   US-PROD-05  no schema change — closing on a BLOCKED batch is a service bug.
--
-- Also fixes a gap that has nothing to do with these stories: the Production
-- tables were created by 20260910152117 with NO grants for the runtime role, so
-- every Production endpoint fails with "permission denied" on any database
-- built from these migrations. Section 7.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. The demo material issues
-- -----------------------------------------------------------------------------
-- material_issue_lines.lot_id is repointed below, and these rows reference
-- lots in the table it is being pointed away from — they cannot be carried
-- across, because the stock they name does not exist in `stock_lots`.
--
-- Safe to delete: every such row came from the demo seeder, which is
-- idempotent and re-runnable, and no hosted database has any. Anything that
-- was a real record of material leaving a store would make this a data
-- migration instead, and this comment would be a refusal.

DELETE FROM "material_issue_lines";
DELETE FROM "material_issues";

-- -----------------------------------------------------------------------------
-- 2. Material issue allocates from stock_lots
-- -----------------------------------------------------------------------------

ALTER TABLE "material_issue_lines" DROP CONSTRAINT IF EXISTS "material_issue_lines_lot_id_fkey";

ALTER TABLE "material_issue_lines" ADD CONSTRAINT "material_issue_lines_lot_id_fkey"
  FOREIGN KEY ("lot_id") REFERENCES "stock_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- 3. US-PROD-02: a FEFO override is recorded, or it is not an override
-- -----------------------------------------------------------------------------

ALTER TABLE "material_issue_lines"
  ADD COLUMN IF NOT EXISTS "is_fefo_override" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "override_reason" VARCHAR(500);

DO $$
BEGIN
  -- The criterion allows departing from the suggestion; it does not allow
  -- doing so silently. A blank reason is not a reason, so the check tests the
  -- trimmed length rather than NULL alone.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'material_issue_lines_override_has_reason') THEN
    ALTER TABLE "material_issue_lines" ADD CONSTRAINT "material_issue_lines_override_has_reason"
      CHECK ("is_fefo_override" = false OR length(btrim(coalesce("override_reason", ''))) > 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'material_issue_lines_quantity_positive') THEN
    ALTER TABLE "material_issue_lines" ADD CONSTRAINT "material_issue_lines_quantity_positive"
      CHECK ("quantity_issued" > 0);
  END IF;
END
$$;

-- -----------------------------------------------------------------------------
-- 4. US-PROD-03: the batch-number convention belongs to the company
-- -----------------------------------------------------------------------------
-- The prefix only. The rest of the shape is fixed, because a free-form format
-- string is a way to configure two companies into the same batch number — and
-- the criterion's other half is that the number is strictly unique.

ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "batch_number_prefix" VARCHAR(8) NOT NULL DEFAULT 'B';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenants_batch_number_prefix_not_blank') THEN
    ALTER TABLE "tenants" ADD CONSTRAINT "tenants_batch_number_prefix_not_blank"
      CHECK (length(btrim("batch_number_prefix")) > 0);
  END IF;
END
$$;

-- -----------------------------------------------------------------------------
-- 5. US-PROD-04: what the packing line produced, and what it consumed
-- -----------------------------------------------------------------------------

ALTER TABLE "batch_packing_records"
  ADD COLUMN IF NOT EXISTS "rejected_quantity" DECIMAL(14,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "pack_variant" VARCHAR(128);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'batch_packing_records_quantities_non_negative') THEN
    ALTER TABLE "batch_packing_records" ADD CONSTRAINT "batch_packing_records_quantities_non_negative"
      CHECK ("packed_quantity" >= 0 AND "rejected_quantity" >= 0);
  END IF;
END
$$;

-- The reconciliation against the bulk yield — packed + rejected must not exceed
-- what the batch actually made — is NOT here. It spans two tables, which a CHECK
-- constraint cannot, and a trigger doing it would fire on every packing write
-- to read a row the service already has in hand. BatchService enforces it.

CREATE TABLE IF NOT EXISTS "batch_packaging_consumptions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "packing_record_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "quantity_consumed" DECIMAL(14,3) NOT NULL,
    "lot_id" UUID,
    "notes" VARCHAR(255),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "batch_packaging_consumptions_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'batch_packaging_consumptions_tenant_id_fkey') THEN
    ALTER TABLE "batch_packaging_consumptions" ADD CONSTRAINT "batch_packaging_consumptions_tenant_id_fkey"
      FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  -- CASCADE: a consumption line is part of the packing record, not a record in
  -- its own right.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'batch_packaging_consumptions_packing_record_id_fkey') THEN
    ALTER TABLE "batch_packaging_consumptions" ADD CONSTRAINT "batch_packaging_consumptions_packing_record_id_fkey"
      FOREIGN KEY ("packing_record_id") REFERENCES "batch_packing_records"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  -- RESTRICT: a component named by a batch record must stay nameable. This is
  -- the row a recall reads.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'batch_packaging_consumptions_item_id_fkey') THEN
    ALTER TABLE "batch_packaging_consumptions" ADD CONSTRAINT "batch_packaging_consumptions_item_id_fkey"
      FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'batch_packaging_consumptions_lot_id_fkey') THEN
    ALTER TABLE "batch_packaging_consumptions" ADD CONSTRAINT "batch_packaging_consumptions_lot_id_fkey"
      FOREIGN KEY ("lot_id") REFERENCES "stock_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'batch_packaging_consumptions_quantity_positive') THEN
    ALTER TABLE "batch_packaging_consumptions" ADD CONSTRAINT "batch_packaging_consumptions_quantity_positive"
      CHECK ("quantity_consumed" > 0);
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS "batch_packaging_consumptions_packing_record_id_item_id_key"
  ON "batch_packaging_consumptions"("packing_record_id", "item_id");

-- Answers the recall question from the component's side: which batches used
-- this carton?
CREATE INDEX IF NOT EXISTS "batch_packaging_consumptions_tenant_id_item_id_idx"
  ON "batch_packaging_consumptions"("tenant_id", "item_id");

-- -----------------------------------------------------------------------------
-- 6. Row-Level Security on the new table
-- -----------------------------------------------------------------------------

ALTER TABLE "batch_packaging_consumptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "batch_packaging_consumptions" FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'batch_packaging_consumptions'
      AND policyname = 'batch_packaging_consumptions_tenant_isolation'
  ) THEN
    CREATE POLICY "batch_packaging_consumptions_tenant_isolation" ON "batch_packaging_consumptions"
      FOR ALL
      USING ("tenant_id" = public.current_tenant_id())
      WITH CHECK ("tenant_id" = public.require_tenant_id());
  END IF;
END
$$;

-- -----------------------------------------------------------------------------
-- 7. The Production module's missing runtime grants
-- -----------------------------------------------------------------------------
-- Nothing to do with US-PROD-01..05, and it blocks all of them.
--
-- 20260910152117_production_quality_gate created seven tables and granted the
-- runtime role nothing on any of them, so on a database built from these
-- migrations every Production endpoint fails with
-- "permission denied for table production_orders". It was invisible on the
-- developer machines because their grants arrived by another route, and on the
-- hosted database because that migration has never run there at all.
--
-- Granted here rather than by editing that migration: it is recorded as applied
-- on databases that have it, so changing its checksum would fail their next
-- deploy.

DO $grants$
DECLARE
  v_role text := 'pharma_app';
  v_table text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
    RAISE NOTICE 'Role % not present; skipping runtime grants.', v_role;
    RETURN;
  END IF;

  FOREACH v_table IN ARRAY ARRAY[
    'material_lots',
    'production_orders',
    'material_issues',
    'material_issue_lines',
    'batches',
    'batch_packing_records',
    'finished_goods_lots',
    'batch_packaging_consumptions'
  ] LOOP
    IF to_regclass('public.' || v_table) IS NOT NULL THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I TO %I', v_table, v_role);
    END IF;
  END LOOP;
END
$grants$;
