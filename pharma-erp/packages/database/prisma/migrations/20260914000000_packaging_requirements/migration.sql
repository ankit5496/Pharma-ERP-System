-- =============================================================================
-- Packaging Requirement Master (US-MD-06)
-- =============================================================================
-- What a product's pack consumes, per pack presentation, so that a shortage of
-- cartons is found before the batch reaches the packing line rather than on it.
--
-- The four acceptance criteria, and where each is enforced:
--
--   "A finished product cannot go into a Work Order until it has at least one
--    active Packaging Requirement Master entry."
--      -> `is_active` here; the gate itself is in
--         ProductionService.createProductionOrder, beside the identical
--         active-BOM check US-MD-03 already put there. NOT a constraint,
--         because it is a rule about a DIFFERENT table's inserts and SQL has no
--         way to say "refuse this insert unless a row exists over there" short
--         of a trigger that would fire on every work order ever raised.
--
--   "Quantities must scale correctly with the batch size, exactly like BOM
--    raw-material quantities do."
--      -> `units_per_pack` and `quantity_basis` are what make that computable;
--         the arithmetic lives in PackagingService and uses the same Decimal
--         ratio as MaterialIssueService.
--
--   "The packaging availability check must run automatically."
--      -> computed on read against `stock_lots`, which already exists. Nothing
--         stored, nothing to go stale, no manual cross-check.
--
--   "A packaging shortage must be visible on the Production/Purchase dashboard
--    before the batch is due for packing."
--      -> the sweep joins these tables to `production_plans` (which carries
--         pack_variant and planned_date) and `stock_lots`. All three exist on
--         the hosted database, so unlike US-MD-05 this criterion is not
--         blocked by the missing Production module.
--
-- Guarded with IF NOT EXISTS throughout, matching the migrations before it.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Enums
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PackagingLevel') THEN
    CREATE TYPE "PackagingLevel" AS ENUM ('PRIMARY', 'SECONDARY', 'TERTIARY');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PackagingQuantityBasis') THEN
    CREATE TYPE "PackagingQuantityBasis" AS ENUM ('PER_PACK', 'PER_BATCH');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PackagingComponentRequirement') THEN
    CREATE TYPE "PackagingComponentRequirement" AS ENUM ('MANDATORY', 'OPTIONAL');
  END IF;
END
$$;

-- -----------------------------------------------------------------------------
-- 2. The pack specification
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "packaging_requirements" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "pack_variant" VARCHAR(128) NOT NULL,
    "units_per_pack" DECIMAL(14,3) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "notes" VARCHAR(1000),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "packaging_requirements_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'packaging_requirements_tenant_id_fkey') THEN
    ALTER TABLE "packaging_requirements" ADD CONSTRAINT "packaging_requirements_tenant_id_fkey"
      FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'packaging_requirements_product_id_fkey') THEN
    ALTER TABLE "packaging_requirements" ADD CONSTRAINT "packaging_requirements_product_id_fkey"
      FOREIGN KEY ("product_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$$;

-- -----------------------------------------------------------------------------
-- 3. The component lines
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "packaging_requirement_lines" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "requirement_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "level" "PackagingLevel" NOT NULL,
    "quantity_per" DECIMAL(14,3) NOT NULL,
    "quantity_basis" "PackagingQuantityBasis" NOT NULL,
    "requirement" "PackagingComponentRequirement" NOT NULL DEFAULT 'MANDATORY',
    "notes" VARCHAR(255),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "packaging_requirement_lines_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'packaging_requirement_lines_tenant_id_fkey') THEN
    ALTER TABLE "packaging_requirement_lines" ADD CONSTRAINT "packaging_requirement_lines_tenant_id_fkey"
      FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  -- CASCADE: a line is part of the specification, not a record in its own right.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'packaging_requirement_lines_requirement_id_fkey') THEN
    ALTER TABLE "packaging_requirement_lines" ADD CONSTRAINT "packaging_requirement_lines_requirement_id_fkey"
      FOREIGN KEY ("requirement_id") REFERENCES "packaging_requirements"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  -- RESTRICT: a component named by a live specification must not vanish.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'packaging_requirement_lines_item_id_fkey') THEN
    ALTER TABLE "packaging_requirement_lines" ADD CONSTRAINT "packaging_requirement_lines_item_id_fkey"
      FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$$;

-- -----------------------------------------------------------------------------
-- 4. Indexes
-- -----------------------------------------------------------------------------

-- One live specification per product per pack variant. PARTIAL, so retiring a
-- pack frees its variant name for a replacement — the register only ever shows
-- rows where deleted_at IS NULL, and a conflict against an invisible row is not
-- a refusal anybody can act on.
CREATE UNIQUE INDEX IF NOT EXISTS "packaging_requirements_tenant_id_product_id_pack_variant_key"
  ON "packaging_requirements"("tenant_id", "product_id", "pack_variant")
  WHERE "deleted_at" IS NULL;

-- The AC1 gate asks exactly this: has this product an active spec?
CREATE INDEX IF NOT EXISTS "packaging_requirements_tenant_id_product_id_is_active_idx"
  ON "packaging_requirements"("tenant_id", "product_id", "is_active", "deleted_at");

CREATE UNIQUE INDEX IF NOT EXISTS "packaging_requirement_lines_requirement_id_item_id_key"
  ON "packaging_requirement_lines"("requirement_id", "item_id");

-- The reverse question the shortage sweep asks: which packs consume this
-- component, and therefore whose batch is at risk when it runs low?
CREATE INDEX IF NOT EXISTS "packaging_requirement_lines_tenant_id_item_id_idx"
  ON "packaging_requirement_lines"("tenant_id", "item_id");

-- -----------------------------------------------------------------------------
-- 5. Invariants
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  -- Zero units per pack would make every PER_PACK quantity a division by zero
  -- the moment the shortage sweep ran.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'packaging_requirements_units_per_pack_positive') THEN
    ALTER TABLE "packaging_requirements" ADD CONSTRAINT "packaging_requirements_units_per_pack_positive"
      CHECK ("units_per_pack" > 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'packaging_requirements_pack_variant_not_blank') THEN
    ALTER TABLE "packaging_requirements" ADD CONSTRAINT "packaging_requirements_pack_variant_not_blank"
      CHECK (length(btrim("pack_variant")) > 0);
  END IF;

  -- A component consumed in zero quantity is not a component of the pack.
  -- Stated as > 0 rather than >= 0 so an empty line cannot silently satisfy
  -- "at least one component".
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'packaging_requirement_lines_quantity_positive') THEN
    ALTER TABLE "packaging_requirement_lines" ADD CONSTRAINT "packaging_requirement_lines_quantity_positive"
      CHECK ("quantity_per" > 0);
  END IF;
END
$$;

-- -----------------------------------------------------------------------------
-- 6. Row-Level Security
-- -----------------------------------------------------------------------------

ALTER TABLE "packaging_requirements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "packaging_requirements" FORCE ROW LEVEL SECURITY;
ALTER TABLE "packaging_requirement_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "packaging_requirement_lines" FORCE ROW LEVEL SECURITY;

DO $rls$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['packaging_requirements', 'packaging_requirement_lines'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = v_table
        AND policyname = v_table || '_tenant_isolation'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I FOR ALL '
        'USING ("tenant_id" = public.current_tenant_id()) '
        'WITH CHECK ("tenant_id" = public.require_tenant_id())',
        v_table || '_tenant_isolation',
        v_table
      );
    END IF;
  END LOOP;
END
$rls$;

-- -----------------------------------------------------------------------------
-- 7. No hard deletes on the specification
-- -----------------------------------------------------------------------------
-- The pack specification a batch was packed to is part of that batch's record.
-- Lines are NOT protected: they cascade from the specification, and blocking
-- DELETE there would make it uneditable.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'packaging_requirements'::regclass
      AND tgname = 'packaging_requirements_no_hard_delete'
  ) THEN
    CREATE TRIGGER "packaging_requirements_no_hard_delete"
      BEFORE DELETE ON "packaging_requirements"
      FOR EACH ROW EXECUTE FUNCTION public.prevent_hard_delete();
  END IF;
END
$$;

-- -----------------------------------------------------------------------------
-- 8. Privileges for the runtime role
-- -----------------------------------------------------------------------------

DO $grants$
DECLARE
  v_role text := 'pharma_app';
  v_table text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
    RAISE NOTICE 'Role % not present; skipping runtime grants.', v_role;
    RETURN;
  END IF;

  FOREACH v_table IN ARRAY ARRAY['packaging_requirements', 'packaging_requirement_lines'] LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I TO %I', v_table, v_role);
  END LOOP;
END
$grants$;
