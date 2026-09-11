-- =============================================================================
-- Master data registers: items, bills of material
-- =============================================================================
-- RECONSTRUCTED FROM THE LIVE DATABASE.
--
-- This migration was applied to the shared Render database from another branch
-- and its original SQL is not in this repository. It has been rebuilt here from
-- the live schema so that `prisma migrate` has a complete, contiguous history:
-- Prisma compares the migrations folder against the `_prisma_migrations` table
-- and refuses to deploy when a recorded migration has no file.
--
-- It is already recorded as applied on Render, so this file will never run
-- there. It runs only when somebody builds a fresh database from this repo,
-- which is exactly why it has to be faithful.
--
-- Two things `prisma migrate diff` could NOT see, added back by hand:
--
--   * ROW-LEVEL SECURITY. Prisma's differ does not read pg_policy, so the
--     generated SQL had none. Committing it as-is would have produced a fresh
--     database where items, boms and bom_lines carry tenant_id with no policy
--     protecting it — a silent cross-tenant read, and the one class of bug no
--     application test catches because the application filters by tenant too.
--   * The prevent_hard_delete triggers and the runtime-role grants.
--
-- Both were verified against the live database and match what is there.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Enum
-- -----------------------------------------------------------------------------

CREATE TYPE "ItemType" AS ENUM ('RAW_MATERIAL', 'PACKING_MATERIAL', 'SEMI_FINISHED', 'FINISHED_GOOD');

-- -----------------------------------------------------------------------------
-- 2. Tables
-- -----------------------------------------------------------------------------

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

CREATE TABLE "bom_lines" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "bom_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "quantity_per" DECIMAL(14,3) NOT NULL,
    "notes" VARCHAR(255),

    CONSTRAINT "bom_lines_pkey" PRIMARY KEY ("id")
);

-- -----------------------------------------------------------------------------
-- 3. Indexes
-- -----------------------------------------------------------------------------

CREATE UNIQUE INDEX "items_tenant_id_code_key" ON "items"("tenant_id", "code");
CREATE INDEX "items_tenant_id_type_deleted_at_idx" ON "items"("tenant_id", "type", "deleted_at");

CREATE UNIQUE INDEX "boms_tenant_id_product_id_version_key" ON "boms"("tenant_id", "product_id", "version");
CREATE INDEX "boms_tenant_id_deleted_at_idx" ON "boms"("tenant_id", "deleted_at");

CREATE UNIQUE INDEX "bom_lines_bom_id_item_id_key" ON "bom_lines"("bom_id", "item_id");

-- -----------------------------------------------------------------------------
-- 4. Foreign keys
-- -----------------------------------------------------------------------------

ALTER TABLE "items" ADD CONSTRAINT "items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "boms" ADD CONSTRAINT "boms_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "boms" ADD CONSTRAINT "boms_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "bom_lines" ADD CONSTRAINT "bom_lines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bom_lines" ADD CONSTRAINT "bom_lines_bom_id_fkey" FOREIGN KEY ("bom_id") REFERENCES "boms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bom_lines" ADD CONSTRAINT "bom_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- 5. Row-Level Security
-- -----------------------------------------------------------------------------
-- Matches the live database exactly: one FOR ALL policy per table, USING
-- current_tenant_id() and WITH CHECK require_tenant_id(), enabled AND forced so
-- the table owner is bound by it too.

DO $rls$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['items', 'boms', 'bom_lines'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', v_table);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', v_table);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL '
      'USING ("tenant_id" = public.current_tenant_id()) '
      'WITH CHECK ("tenant_id" = public.require_tenant_id())',
      v_table || '_tenant_isolation',
      v_table
    );
  END LOOP;
END
$rls$;

-- -----------------------------------------------------------------------------
-- 6. No hard deletes on the registers
-- -----------------------------------------------------------------------------
-- items and boms carry deleted_at and are referenced by historic documents, so
-- removal is a soft delete. bom_lines has no deleted_at and cascades from its
-- bom — blocking DELETE there would block editing a formulation.

CREATE TRIGGER "items_no_hard_delete"
  BEFORE DELETE ON "items"
  FOR EACH ROW EXECUTE FUNCTION public.prevent_hard_delete();

CREATE TRIGGER "boms_no_hard_delete"
  BEFORE DELETE ON "boms"
  FOR EACH ROW EXECUTE FUNCTION public.prevent_hard_delete();

-- -----------------------------------------------------------------------------
-- 7. Privileges for the runtime role
-- -----------------------------------------------------------------------------
-- A no-op when the role does not exist yet, which is the case on a managed
-- database where scripts/render-bootstrap.sql runs after the migrations.

DO $grants$
DECLARE
  v_role text := 'pharma_app';
  v_table text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
    RAISE NOTICE 'Role % not present; skipping runtime grants.', v_role;
    RETURN;
  END IF;

  FOREACH v_table IN ARRAY ARRAY['items', 'boms', 'bom_lines'] LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I TO %I', v_table, v_role);
  END LOOP;
END
$grants$;
