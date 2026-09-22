-- Job work gets its own production order.
--
-- A new table alongside `production_orders`, not a change to it: the normal
-- Production & Quality Gate workflow is untouched by this migration, which is
-- the point of the separation. Nothing is moved, nothing is backfilled, and
-- production orders already tagged to a job-work order keep working exactly as
-- they did.
--
-- The new table OWNS NO MATERIAL. It references the approved receipt, whose
-- lines already hold every drum, batch marking, quantity and expiry date.

CREATE TYPE "JobWorkProductionOrderStatus" AS ENUM (
  'DRAFT',
  'READY_FOR_PRODUCTION',
  'IN_PRODUCTION',
  'PRODUCTION_COMPLETED',
  'READY_FOR_BATCH_RELEASE',
  'BATCH_RELEASED',
  'CANCELLED'
);

CREATE TABLE "job_work_production_orders" (
  "id"                    UUID           NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"             UUID           NOT NULL,
  "order_number"          VARCHAR(32)    NOT NULL,
  "job_work_order_id"     UUID           NOT NULL,
  "material_receipt_id"   UUID           NOT NULL,
  "status"                "JobWorkProductionOrderStatus" NOT NULL DEFAULT 'DRAFT',
  "planned_quantity"      DECIMAL(14, 3) NOT NULL,
  "planned_start_on"      DATE,
  "planned_completion_on" DATE,
  "notes"                 VARCHAR(1000),
  "created_by_id"         UUID,
  "created_at"            TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"            TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at"            TIMESTAMPTZ(6),

  CONSTRAINT "job_work_production_orders_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "job_work_production_orders"
  ADD CONSTRAINT "job_work_production_orders_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "job_work_production_orders_job_work_order_id_fkey"
    FOREIGN KEY ("job_work_order_id") REFERENCES "job_work_orders"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "job_work_production_orders_material_receipt_id_fkey"
    FOREIGN KEY ("material_receipt_id") REFERENCES "job_work_material_receipts"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "job_work_production_orders_created_by_id_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "job_work_production_orders_tenant_id_order_number_key"
  ON "job_work_production_orders" ("tenant_id", "order_number");

CREATE INDEX "job_work_production_orders_tenant_id_job_work_order_id_idx"
  ON "job_work_production_orders" ("tenant_id", "job_work_order_id");

CREATE INDEX "job_work_production_orders_tenant_id_material_receipt_id_idx"
  ON "job_work_production_orders" ("tenant_id", "material_receipt_id");

CREATE INDEX "job_work_production_orders_tenant_id_status_idx"
  ON "job_work_production_orders" ("tenant_id", "status");

-- ---------------------------------------------------------------------------
-- Tenant isolation, the same as every other table in this schema.
--
-- ENABLE puts the policy on; FORCE applies it to the table owner too, so a
-- mistake in a later migration or a console session cannot read across
-- companies. A manufacturing instruction naming a principal is exactly the
-- kind of record that must not leak.
-- ---------------------------------------------------------------------------

ALTER TABLE "job_work_production_orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "job_work_production_orders" FORCE ROW LEVEL SECURITY;

CREATE POLICY "job_work_production_orders_tenant_isolation"
  ON "job_work_production_orders" FOR ALL
  USING ("tenant_id" = public.current_tenant_id())
  WITH CHECK ("tenant_id" = public.require_tenant_id());

-- No hard deletes: a production order is a manufacturing record.
CREATE TRIGGER "job_work_production_orders_no_hard_delete"
  BEFORE DELETE ON "job_work_production_orders"
  FOR EACH ROW EXECUTE FUNCTION public.prevent_hard_delete();

-- Privileges for the runtime role; a no-op where it does not exist yet.
DO $grants$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pharma_app') THEN
    RAISE NOTICE 'Role pharma_app not present; skipping runtime grants.';
    RETURN;
  END IF;

  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "job_work_production_orders" TO "pharma_app";
END
$grants$;
