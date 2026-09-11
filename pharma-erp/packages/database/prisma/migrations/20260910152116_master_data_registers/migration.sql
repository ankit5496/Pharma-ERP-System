-- =============================================================================
-- Master data registers: items, formulations and their lines
-- =============================================================================
-- Split out of the original single Production & Quality Gate migration so the
-- registers can be created without the transactional tables that consume them.
-- The split is along a real seam, not an arbitrary one: these three tables are
-- what OTHER records point at, they reference nothing outside themselves and
-- `tenants`, and they are the only part of that work the Master Data section
-- needs.
--
-- 20260910152117_production_quality_gate carries the remaining seven tables and
-- depends on this one — material_lots, production_orders and material_issue_lines
-- all hold a foreign key into `items`, and production_orders into `boms`.
-- =============================================================================

-- CreateEnum
CREATE TYPE "ItemType" AS ENUM ('RAW_MATERIAL', 'PACKING_MATERIAL', 'FINISHED_GOOD');

-- CreateTable
CREATE TABLE "items" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "type" "ItemType" NOT NULL,
    "uom" VARCHAR(16) NOT NULL,
    "shelf_life_months" INTEGER,
    "hsn_code" VARCHAR(16),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "boms" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "output_quantity" DECIMAL(14,3) NOT NULL,
    "instructions" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "effective_from" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "boms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bom_lines" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "bom_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "quantity_per" DECIMAL(14,3) NOT NULL,
    "notes" VARCHAR(255),

    CONSTRAINT "bom_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "items_tenant_id_type_deleted_at_idx" ON "items"("tenant_id", "type", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "items_tenant_id_code_key" ON "items"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "boms_tenant_id_deleted_at_idx" ON "boms"("tenant_id", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "boms_tenant_id_product_id_version_key" ON "boms"("tenant_id", "product_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "bom_lines_bom_id_item_id_key" ON "bom_lines"("bom_id", "item_id");

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boms" ADD CONSTRAINT "boms_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boms" ADD CONSTRAINT "boms_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bom_lines" ADD CONSTRAINT "bom_lines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bom_lines" ADD CONSTRAINT "bom_lines_bom_id_fkey" FOREIGN KEY ("bom_id") REFERENCES "boms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bom_lines" ADD CONSTRAINT "bom_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =============================================================================
-- Row-Level Security, guards and invariants
-- =============================================================================
-- Everything above this line is Prisma's generated DDL. Everything below is the
-- part that makes these tables safe to expose to a request-scoped connection,
-- and it follows 20260901000100_rls_and_guards exactly:
--
--   USING      (tenant_id = current_tenant_id())  -- rows you may see
--   WITH CHECK (tenant_id = require_tenant_id())  -- rows you may write
--
-- require_tenant_id() raises when no tenant is set on the transaction, so a
-- query that forgets to establish context fails closed rather than writing a
-- row nobody can subsequently read.
--
-- FORCE ROW LEVEL SECURITY is applied to every table here. Without it the table
-- OWNER is exempt, and the owner is the role migrations run as — so a future
-- script run on the migration connection would silently see every tenant. That
-- matters more on the hosted database than locally, because there the app and
-- the migrations share one role.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Tenant isolation
-- -----------------------------------------------------------------------------

DO $rls$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'items',
    'boms',
    'bom_lines'
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
-- Applied only to tables carrying `deleted_at`. bom_lines is deliberately
-- excluded: it cascades with its formulation and has no independent existence,
-- so blocking its DELETE would make correcting an unposted formulation
-- impossible.

DO $guards$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'items',
    'boms'
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
-- Enforced in the database, not only in the service. A formulation line of zero
-- is not a recipe, and a batch size of zero divides by zero when the order is
-- scaled.

ALTER TABLE "bom_lines"
  ADD CONSTRAINT "bom_lines_quantity_per_positive"
  CHECK ("quantity_per" > 0);

ALTER TABLE "boms"
  ADD CONSTRAINT "boms_output_quantity_positive"
  CHECK ("output_quantity" > 0);

-- -----------------------------------------------------------------------------
-- 4. One active formulation per product
-- -----------------------------------------------------------------------------
-- A partial unique index rather than application logic: "which recipe is
-- current" must have exactly one answer, and two concurrent activations would
-- otherwise both succeed.

CREATE UNIQUE INDEX "boms_one_active_version_per_product"
  ON "boms" ("tenant_id", "product_id")
  WHERE "is_active" AND "deleted_at" IS NULL;
