-- Purchase requisition: the fields the requisition form captures, and the
-- per-company switch that governs automatic creation.
--
-- WHAT THIS DOES NOT DO, deliberately. It creates no table. Every value the
-- form offers for selection already has a master somewhere -- items, parties,
-- production plans -- and this migration adds only the columns on
-- `purchase_requisitions` that had nowhere to live, plus one flag on
-- `tenants`. Everything selectable is a foreign key into master data that
-- already exists rather than a copy of it, so a requisition cannot disagree
-- with the master it was raised from.
--
-- Every column is nullable or defaulted, so existing rows stay valid and no
-- code that does not yet know about them breaks.

-- -----------------------------------------------------------------------------
-- 1. Automatic creation, per company
-- -----------------------------------------------------------------------------
-- The reorder check has always raised requisitions unconditionally. This makes
-- that a choice, and DEFAULTS IT TO TRUE so the behaviour every existing
-- tenant has today is the behaviour it keeps after this migration runs.
--
-- It lives on `tenants` rather than in a settings table because it is one
-- boolean, `tenants` is already the row every request resolves anyway, and a
-- settings table would need its own RLS policies to be as safe as this column
-- is for free.

ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "auto_requisition_enabled" BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN "tenants"."auto_requisition_enabled" IS
  'When true, the reorder check raises AUTO_REORDER requisitions for items below their reorder level. When false it reports what it would have raised and creates nothing.';

-- -----------------------------------------------------------------------------
-- 2. Packaging level
-- -----------------------------------------------------------------------------
-- An enum rather than a master table: the three levels are a property of
-- packaging itself and not something a company configures, so a table would be
-- three rows nobody may edit plus a join on every read.

DO $packaging_level$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PackagingLevel') THEN
    CREATE TYPE "PackagingLevel" AS ENUM ('PRIMARY', 'SECONDARY', 'TERTIARY');
  END IF;
END
$packaging_level$;

-- -----------------------------------------------------------------------------
-- 3. Requisition form fields
-- -----------------------------------------------------------------------------

ALTER TABLE "purchase_requisitions"
  -- The finished product this material is ultimately for. An Item of type
  -- FINISHED_GOOD, pointed at rather than named, so it cannot drift from the
  -- item master. Nullable: a requisition for a raw material that serves no one
  -- product in particular has no answer here, and inventing one would be worse
  -- than leaving it blank.
  ADD COLUMN IF NOT EXISTS "finished_product_id" UUID,

  -- Pack presentation, e.g. "10x10 blister". Free text, matching
  -- `production_plans.pack_variant` -- there is no pack-variant master to point
  -- at, and creating one is not this task.
  ADD COLUMN IF NOT EXISTS "pack_variant" VARCHAR(128),

  -- Which packaging component, when the requisition is part of a pack
  -- configuration. A second reference INTO THE ITEM MASTER, not a copy of it.
  -- It is distinct from `item_id`: `item_id` is what is being bought, and this
  -- is the component of the finished pack it plays a part in.
  ADD COLUMN IF NOT EXISTS "packaging_component_id" UUID,

  ADD COLUMN IF NOT EXISTS "packaging_level" "PackagingLevel",

  -- Quantity of this component per unit or per batch of the finished product.
  -- Distinct from `required_quantity`, which is how much to BUY: this is the
  -- rate the buy quantity was derived from, and keeping it makes the
  -- derivation auditable later.
  ADD COLUMN IF NOT EXISTS "quantity_per_unit" NUMERIC(18, 4),

  -- Whether this component is mandatory to the pack or optional. Defaults to
  -- mandatory, which is the safe reading: treating an unspecified component as
  -- optional invites it to be dropped from an order.
  ADD COLUMN IF NOT EXISTS "is_mandatory" BOOLEAN NOT NULL DEFAULT true;

-- Foreign keys, added separately so the ADD COLUMN above stays readable.
--
-- ON DELETE RESTRICT throughout, consistent with every other reference in this
-- schema: master data is soft-deleted, and a requisition that cited an item
-- must keep citing it.
--
-- NOTE ON TENANCY. A foreign key is checked by the system and does not consult
-- row-level security, so the constraint alone would permit a row to reference
-- another tenant's item. The services resolve every id through the
-- tenant-scoped client before writing, which is where that is actually
-- prevented -- the same approach `item_id` and `preferred_vendor_id` already
-- rely on.

DO $foreign_keys$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'purchase_requisitions_finished_product_id_fkey'
  ) THEN
    ALTER TABLE "purchase_requisitions"
      ADD CONSTRAINT "purchase_requisitions_finished_product_id_fkey"
      FOREIGN KEY ("finished_product_id") REFERENCES "items"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'purchase_requisitions_packaging_component_id_fkey'
  ) THEN
    ALTER TABLE "purchase_requisitions"
      ADD CONSTRAINT "purchase_requisitions_packaging_component_id_fkey"
      FOREIGN KEY ("packaging_component_id") REFERENCES "items"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$foreign_keys$;

CREATE INDEX IF NOT EXISTS "purchase_requisitions_tenant_id_finished_product_id_idx"
  ON "purchase_requisitions" ("tenant_id", "finished_product_id");

CREATE INDEX IF NOT EXISTS "purchase_requisitions_tenant_id_packaging_component_id_idx"
  ON "purchase_requisitions" ("tenant_id", "packaging_component_id");

-- -----------------------------------------------------------------------------
-- 4. Privileges
-- -----------------------------------------------------------------------------
-- Nothing to do, and that is worth stating rather than leaving a reader to
-- wonder. The grants in scripts/render-bootstrap.sql are table-level, and
-- row-level security policies are table-level too, so both already cover
-- columns added after the fact. A column-level grant here would in fact NARROW
-- what `pharma_app` can do.

-- -----------------------------------------------------------------------------
-- 5. Assertions
-- -----------------------------------------------------------------------------
-- This migration is additive, so the only way it can be wrong is by not having
-- happened. Checked here rather than trusted, because a silently skipped
-- IF NOT EXISTS is exactly the failure that surfaces much later as a confusing
-- Prisma drift error.

DO $verify$
DECLARE
  v_missing TEXT;
BEGIN
  SELECT string_agg(required.expected, ', ')
    INTO v_missing
    FROM (
      VALUES
        ('purchase_requisitions.finished_product_id'),
        ('purchase_requisitions.pack_variant'),
        ('purchase_requisitions.packaging_component_id'),
        ('purchase_requisitions.packaging_level'),
        ('purchase_requisitions.quantity_per_unit'),
        ('purchase_requisitions.is_mandatory'),
        ('tenants.auto_requisition_enabled')
    ) AS required(expected)
   WHERE NOT EXISTS (
     SELECT 1
       FROM information_schema.columns c
      WHERE c.table_schema = 'public'
        AND c.table_name = split_part(required.expected, '.', 1)
        AND c.column_name = split_part(required.expected, '.', 2)
   );

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'Requisition form migration did not apply cleanly; missing: %', v_missing;
  END IF;
END
$verify$;
