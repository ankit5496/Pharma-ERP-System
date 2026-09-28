-- Which packing components a job-work batch actually used.
--
-- The internal batch record has kept this since packing was built
-- (`batch_packaging_consumptions`); the job-work one had only a free-text pack
-- variant, so a recall could say a batch was packed but not which carton lot
-- went onto it. Its own table, like every other job-work record: a job-work
-- batch is not a `Batch`, and one child table cannot point at two parents.

CREATE TABLE "job_work_batch_packaging_consumptions" (
  "id"                UUID           NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"         UUID           NOT NULL,
  "job_work_batch_id" UUID           NOT NULL,
  "item_id"           UUID           NOT NULL,
  "quantity_consumed" DECIMAL(14, 3) NOT NULL,
  "lot_id"            UUID,
  "notes"             VARCHAR(255),
  "created_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "job_work_batch_packaging_consumptions_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "job_work_batch_packaging_consumptions"
  ADD CONSTRAINT "job_work_batch_packaging_consumptions_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "job_work_batch_packaging_consumptions_batch_fkey"
    FOREIGN KEY ("job_work_batch_id") REFERENCES "job_work_batches"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "job_work_batch_packaging_consumptions_item_id_fkey"
    FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "job_work_batch_packaging_consumptions_lot_id_fkey"
    FOREIGN KEY ("lot_id") REFERENCES "stock_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- One line per component per batch: re-recording packing restates what was
-- used rather than adding to it.
CREATE UNIQUE INDEX "job_work_batch_packaging_consumptions_batch_item_key"
  ON "job_work_batch_packaging_consumptions" ("job_work_batch_id", "item_id");

CREATE INDEX "job_work_batch_packaging_consumptions_tenant_id_item_id_idx"
  ON "job_work_batch_packaging_consumptions" ("tenant_id", "item_id");

-- ---------------------------------------------------------------------------
-- Tenant isolation. NO hard-delete guard: re-recording packing replaces the
-- set, and a guard would make removing a component impossible.
-- ---------------------------------------------------------------------------

ALTER TABLE "job_work_batch_packaging_consumptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "job_work_batch_packaging_consumptions" FORCE ROW LEVEL SECURITY;

CREATE POLICY "job_work_batch_packaging_consumptions_tenant_isolation"
  ON "job_work_batch_packaging_consumptions" FOR ALL
  USING ("tenant_id" = public.current_tenant_id())
  WITH CHECK ("tenant_id" = public.require_tenant_id());

DO $grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pharma_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON TABLE "job_work_batch_packaging_consumptions" TO "pharma_app";
  ELSE
    RAISE NOTICE 'Role pharma_app not present; skipping runtime grants.';
  END IF;
END
$grants$;
