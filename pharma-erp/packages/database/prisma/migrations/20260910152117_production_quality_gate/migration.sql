-- =============================================================================
-- Production & Quality Gate: the transactional tables
-- =============================================================================
-- The second half of the original single migration. Depends on
-- 20260910152116_master_data_registers: material_lots, production_orders,
-- material_issue_lines and finished_goods_lots all hold a foreign key into
-- `items`, and production_orders into `boms`.
--
-- Split so the master-data registers could be created on the hosted database
-- on their own. Applying this one adds manufacture and release on top; until
-- it runs, the Production & Quality Gate workflow has no tables behind it.
-- =============================================================================

-- CreateEnum
CREATE TYPE "MaterialLotStatus" AS ENUM ('QUARANTINE', 'USABLE', 'REJECTED');

-- CreateEnum
CREATE TYPE "ProductionOrderStatus" AS ENUM ('PLANNED', 'MATERIAL_ISSUED', 'IN_PROGRESS', 'PACKED', 'UNDER_TEST', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BatchReleaseStatus" AS ENUM ('PENDING', 'RELEASED', 'BLOCKED');

-- CreateTable
CREATE TABLE "material_lots" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "lot_number" VARCHAR(64) NOT NULL,
    "expiry_date" DATE NOT NULL,
    "received_on" DATE NOT NULL,
    "quantity_received" DECIMAL(14,3) NOT NULL,
    "quantity_available" DECIMAL(14,3) NOT NULL,
    "status" "MaterialLotStatus" NOT NULL DEFAULT 'QUARANTINE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "material_lots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_orders" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_number" VARCHAR(32) NOT NULL,
    "product_id" UUID NOT NULL,
    "bom_id" UUID NOT NULL,
    "planned_quantity" DECIMAL(14,3) NOT NULL,
    "planned_start_on" DATE,
    "status" "ProductionOrderStatus" NOT NULL DEFAULT 'PLANNED',
    "created_by_id" UUID,
    "closed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "production_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material_issues" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "production_order_id" UUID NOT NULL,
    "issued_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issued_by_id" UUID,
    "notes" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "material_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material_issue_lines" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "material_issue_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "lot_id" UUID NOT NULL,
    "quantity_issued" DECIMAL(14,3) NOT NULL,

    CONSTRAINT "material_issue_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batches" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "production_order_id" UUID NOT NULL,
    "batch_number" VARCHAR(32) NOT NULL,
    "manufactured_on" DATE NOT NULL,
    "expiry_date" DATE NOT NULL,
    "planned_quantity" DECIMAL(14,3) NOT NULL,
    "actual_quantity" DECIMAL(14,3),
    "release_status" "BatchReleaseStatus" NOT NULL DEFAULT 'PENDING',
    "release_decided_at" TIMESTAMPTZ(6),
    "release_decided_by_id" UUID,
    "release_notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batch_packing_records" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "packed_quantity" DECIMAL(14,3) NOT NULL,
    "packed_on" DATE NOT NULL,
    "recorded_by_id" UUID,
    "notes" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "batch_packing_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finished_goods_lots" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "quantity_available" DECIMAL(14,3) NOT NULL,
    "expiry_date" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "finished_goods_lots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "material_lots_tenant_id_item_id_status_expiry_date_idx" ON "material_lots"("tenant_id", "item_id", "status", "expiry_date");

-- CreateIndex
CREATE UNIQUE INDEX "material_lots_tenant_id_item_id_lot_number_key" ON "material_lots"("tenant_id", "item_id", "lot_number");

-- CreateIndex
CREATE INDEX "production_orders_tenant_id_status_deleted_at_idx" ON "production_orders"("tenant_id", "status", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "production_orders_tenant_id_order_number_key" ON "production_orders"("tenant_id", "order_number");

-- CreateIndex
CREATE INDEX "material_issues_tenant_id_production_order_id_idx" ON "material_issues"("tenant_id", "production_order_id");

-- CreateIndex
CREATE INDEX "material_issue_lines_material_issue_id_idx" ON "material_issue_lines"("material_issue_id");

-- CreateIndex
CREATE INDEX "material_issue_lines_lot_id_idx" ON "material_issue_lines"("lot_id");

-- CreateIndex
CREATE INDEX "batches_tenant_id_release_status_deleted_at_idx" ON "batches"("tenant_id", "release_status", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "batches_tenant_id_batch_number_key" ON "batches"("tenant_id", "batch_number");

-- CreateIndex
CREATE UNIQUE INDEX "batch_packing_records_batch_id_key" ON "batch_packing_records"("batch_id");

-- CreateIndex
CREATE INDEX "batch_packing_records_tenant_id_idx" ON "batch_packing_records"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "finished_goods_lots_batch_id_key" ON "finished_goods_lots"("batch_id");

-- CreateIndex
CREATE INDEX "finished_goods_lots_tenant_id_item_id_expiry_date_idx" ON "finished_goods_lots"("tenant_id", "item_id", "expiry_date");

-- AddForeignKey
ALTER TABLE "material_lots" ADD CONSTRAINT "material_lots_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_lots" ADD CONSTRAINT "material_lots_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_bom_id_fkey" FOREIGN KEY ("bom_id") REFERENCES "boms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_issues" ADD CONSTRAINT "material_issues_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_issues" ADD CONSTRAINT "material_issues_production_order_id_fkey" FOREIGN KEY ("production_order_id") REFERENCES "production_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_issues" ADD CONSTRAINT "material_issues_issued_by_id_fkey" FOREIGN KEY ("issued_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_issue_lines" ADD CONSTRAINT "material_issue_lines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_issue_lines" ADD CONSTRAINT "material_issue_lines_material_issue_id_fkey" FOREIGN KEY ("material_issue_id") REFERENCES "material_issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_issue_lines" ADD CONSTRAINT "material_issue_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_issue_lines" ADD CONSTRAINT "material_issue_lines_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "material_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batches" ADD CONSTRAINT "batches_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batches" ADD CONSTRAINT "batches_production_order_id_fkey" FOREIGN KEY ("production_order_id") REFERENCES "production_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batches" ADD CONSTRAINT "batches_release_decided_by_id_fkey" FOREIGN KEY ("release_decided_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_packing_records" ADD CONSTRAINT "batch_packing_records_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_packing_records" ADD CONSTRAINT "batch_packing_records_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_packing_records" ADD CONSTRAINT "batch_packing_records_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finished_goods_lots" ADD CONSTRAINT "finished_goods_lots_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finished_goods_lots" ADD CONSTRAINT "finished_goods_lots_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finished_goods_lots" ADD CONSTRAINT "finished_goods_lots_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =============================================================================
-- Row-Level Security, guards and invariants
-- =============================================================================
-- Identical treatment to the master-data registers; see
-- 20260910152116_master_data_registers for the reasoning, which is the same
-- reasoning as 20260901000100_rls_and_guards.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Tenant isolation
-- -----------------------------------------------------------------------------

DO $rls$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'material_lots',
    'production_orders',
    'material_issues',
    'material_issue_lines',
    'batches',
    'batch_packing_records',
    'finished_goods_lots'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', v_table);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', v_table);

    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL '
      'USING ("tenant_id" = public.current_tenant_id()) '
      'WITH CHECK ("tenant_id" = public.require_tenant_id())',
      v_table || '_tenant_isolation', v_table);
  END LOOP;
END
$rls$;

-- -----------------------------------------------------------------------------
-- 2. No hard deletes on the compliance-relevant records
-- -----------------------------------------------------------------------------
-- Applied only to tables carrying `deleted_at`. The line tables are deliberately
-- excluded: they cascade with their header and have no independent existence.

DO $guards$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'material_lots',
    'production_orders',
    'batches'
  ]
  LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE DELETE ON %I '
      'FOR EACH ROW EXECUTE FUNCTION public.prevent_hard_delete()',
      v_table || '_no_hard_delete', v_table);
  END LOOP;
END
$guards$;

-- -----------------------------------------------------------------------------
-- 3. Quantity invariants
-- -----------------------------------------------------------------------------
-- Enforced in the database, not only in the service. An over-issue that leaves
-- negative stock is not a validation nicety: it is phantom material that a
-- reconciliation will later have to explain to an inspector.

ALTER TABLE "material_lots"
  ADD CONSTRAINT "material_lots_quantity_available_non_negative"
  CHECK ("quantity_available" >= 0);

ALTER TABLE "material_lots"
  ADD CONSTRAINT "material_lots_quantity_available_within_received"
  CHECK ("quantity_available" <= "quantity_received");

ALTER TABLE "material_lots"
  ADD CONSTRAINT "material_lots_quantity_received_positive"
  CHECK ("quantity_received" > 0);

ALTER TABLE "material_issue_lines"
  ADD CONSTRAINT "material_issue_lines_quantity_positive"
  CHECK ("quantity_issued" > 0);

ALTER TABLE "production_orders"
  ADD CONSTRAINT "production_orders_planned_quantity_positive"
  CHECK ("planned_quantity" > 0);

ALTER TABLE "batches"
  ADD CONSTRAINT "batches_planned_quantity_positive"
  CHECK ("planned_quantity" > 0);

ALTER TABLE "batches"
  ADD CONSTRAINT "batches_actual_quantity_non_negative"
  CHECK ("actual_quantity" IS NULL OR "actual_quantity" >= 0);

ALTER TABLE "batch_packing_records"
  ADD CONSTRAINT "batch_packing_records_packed_quantity_non_negative"
  CHECK ("packed_quantity" >= 0);

ALTER TABLE "finished_goods_lots"
  ADD CONSTRAINT "finished_goods_lots_quantity_non_negative"
  CHECK ("quantity_available" >= 0);

-- A batch cannot expire before it was made. Cheap to state, and catches a
-- transposed date entry that would otherwise print on a carton.
ALTER TABLE "batches"
  ADD CONSTRAINT "batches_expiry_after_manufacture"
  CHECK ("expiry_date" > "manufactured_on");

-- -----------------------------------------------------------------------------
-- 4. The release decision must be evidenced
-- -----------------------------------------------------------------------------
-- A decided batch records who decided and when. PENDING carries neither.
-- Stated as a constraint because the release flag is the single field that
-- determines whether stock may be sold, and an unattributed decision is not a
-- decision anyone can stand behind at an audit.

ALTER TABLE "batches"
  ADD CONSTRAINT "batches_release_decision_is_attributed"
  CHECK (
    ("release_status" = 'PENDING'
      AND "release_decided_at" IS NULL
      AND "release_decided_by_id" IS NULL)
    OR
    ("release_status" <> 'PENDING'
      AND "release_decided_at" IS NOT NULL)
  );
