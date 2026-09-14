-- =============================================================================
-- Principal & Job-Work Agreement register (US-MD-05)
-- =============================================================================
-- The commercial terms under which this company manufactures for a brand owner,
-- and the mapping that says which of our formulations is sold under which of
-- their brands.
--
-- The two acceptance criteria, and where each is enforced:
--
--   "The billing model is a mandatory field on the agreement and cannot be
--    changed on an order that is already in production."
--
--      FIRST HALF  -> job_work_agreements.billing_model is NOT NULL, below.
--      SECOND HALF -> NOT ENFORCED YET, and deliberately so. It is a rule about
--          production ORDERS, and `production_orders` does not exist on the
--          hosted database — the Production & Quality Gate migration has never
--          run there. Adding a column to a table that is absent would fail the
--          deploy outright.
--
--          What is owed when Production lands: production_orders gains
--          `agreement_id` and a COPY of `billing_model`, taken at creation the
--          way `bom_id` already is, plus a BEFORE UPDATE trigger refusing a
--          change to that column once status has left PLANNED. A snapshot
--          rather than a join, so renegotiating the agreement cannot rewrite
--          what an in-flight batch was billed on.
--
--   "The product-brand mapping must link one or more of the company's BOMs to
--    the principal's specific brand name and pack design."
--
--      -> job_work_product_mappings, below. The LINK and its uniqueness are
--         here; "one or more" is enforced by the service inside the creating
--         transaction, because a CHECK constraint cannot count rows in another
--         table. The same rule already lives in the service for BOM lines.
--
-- Guarded with IF NOT EXISTS throughout, matching the two migrations before it:
-- the hosted database and a fresh local one are in different states, and one
-- file has to bring either to the same place.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Enums
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BillingModel') THEN
    CREATE TYPE "BillingModel" AS ENUM ('OWN_PROCUREMENT', 'PURE_CONVERSION');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ConversionRateBasis') THEN
    CREATE TYPE "ConversionRateBasis" AS ENUM ('PER_BATCH', 'PER_1000_UNITS', 'PER_PACK', 'PER_KG');
  END IF;
END
$$;

-- -----------------------------------------------------------------------------
-- 2. The agreement
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "job_work_agreements" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "principal_id" UUID NOT NULL,
    "agreement_reference" VARCHAR(64),
    -- US-MD-05, first half. NOT NULL is the criterion.
    "billing_model" "BillingModel" NOT NULL,
    "conversion_charge_rate" DECIMAL(12,2),
    "conversion_rate_basis" "ConversionRateBasis",
    "valid_from" DATE,
    "valid_to" DATE,
    "notes" VARCHAR(1000),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "job_work_agreements_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'job_work_agreements_tenant_id_fkey') THEN
    ALTER TABLE "job_work_agreements" ADD CONSTRAINT "job_work_agreements_tenant_id_fkey"
      FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'job_work_agreements_principal_id_fkey') THEN
    ALTER TABLE "job_work_agreements" ADD CONSTRAINT "job_work_agreements_principal_id_fkey"
      FOREIGN KEY ("principal_id") REFERENCES "parties"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$$;

-- -----------------------------------------------------------------------------
-- 3. The product-to-brand mapping
-- -----------------------------------------------------------------------------
-- No deleted_at, and no prevent_hard_delete trigger: a mapping line belongs to
-- its agreement and cascades from it, exactly as bom_lines do. Blocking DELETE
-- here would block editing the agreement.

CREATE TABLE IF NOT EXISTS "job_work_product_mappings" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "agreement_id" UUID NOT NULL,
    "bom_id" UUID NOT NULL,
    "principal_brand_name" VARCHAR(255) NOT NULL,
    "pack_design_ref" VARCHAR(64),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "job_work_product_mappings_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'job_work_product_mappings_tenant_id_fkey') THEN
    ALTER TABLE "job_work_product_mappings" ADD CONSTRAINT "job_work_product_mappings_tenant_id_fkey"
      FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  -- CASCADE: the lines are part of the agreement, not records in their own right.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'job_work_product_mappings_agreement_id_fkey') THEN
    ALTER TABLE "job_work_product_mappings" ADD CONSTRAINT "job_work_product_mappings_agreement_id_fkey"
      FOREIGN KEY ("agreement_id") REFERENCES "job_work_agreements"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  -- RESTRICT: a formulation named by a live agreement must not vanish.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'job_work_product_mappings_bom_id_fkey') THEN
    ALTER TABLE "job_work_product_mappings" ADD CONSTRAINT "job_work_product_mappings_bom_id_fkey"
      FOREIGN KEY ("bom_id") REFERENCES "boms"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$$;

-- -----------------------------------------------------------------------------
-- 4. Indexes
-- -----------------------------------------------------------------------------

-- One live agreement reference per company. Partial, so retiring an agreement
-- frees its reference for a renegotiated one — the register only ever shows
-- rows where deleted_at IS NULL, and a conflict against an invisible row is
-- not a refusal anyone can act on.
CREATE UNIQUE INDEX IF NOT EXISTS "job_work_agreements_tenant_id_agreement_reference_key"
  ON "job_work_agreements"("tenant_id", "agreement_reference")
  WHERE "agreement_reference" IS NOT NULL AND "deleted_at" IS NULL;

CREATE INDEX IF NOT EXISTS "job_work_agreements_tenant_id_principal_id_deleted_at_idx"
  ON "job_work_agreements"("tenant_id", "principal_id", "deleted_at");

-- Supports "which agreements lapse next", the same question the licence
-- register answers for licences.
CREATE INDEX IF NOT EXISTS "job_work_agreements_tenant_id_valid_to_idx"
  ON "job_work_agreements"("tenant_id", "valid_to");

-- One line per formulation per agreement.
CREATE UNIQUE INDEX IF NOT EXISTS "job_work_product_mappings_agreement_id_bom_id_key"
  ON "job_work_product_mappings"("agreement_id", "bom_id");

-- Answers the reverse question: which principals' brands is this formulation
-- made under? Needed the moment a work order has to print the right carton.
CREATE INDEX IF NOT EXISTS "job_work_product_mappings_tenant_id_bom_id_idx"
  ON "job_work_product_mappings"("tenant_id", "bom_id");

-- -----------------------------------------------------------------------------
-- 5. Invariants
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  -- A rate with no basis is a number nobody can interpret; a basis with no rate
  -- is a unit for nothing. Both together, or neither.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'job_work_agreements_rate_has_basis') THEN
    ALTER TABLE "job_work_agreements" ADD CONSTRAINT "job_work_agreements_rate_has_basis"
      CHECK (("conversion_charge_rate" IS NULL) = ("conversion_rate_basis" IS NULL));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'job_work_agreements_rate_non_negative') THEN
    ALTER TABLE "job_work_agreements" ADD CONSTRAINT "job_work_agreements_rate_non_negative"
      CHECK ("conversion_charge_rate" IS NULL OR "conversion_charge_rate" >= 0);
  END IF;

  -- An agreement that expired before it began is a data-entry error.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'job_work_agreements_valid_to_after_from') THEN
    ALTER TABLE "job_work_agreements" ADD CONSTRAINT "job_work_agreements_valid_to_after_from"
      CHECK ("valid_from" IS NULL OR "valid_to" IS NULL OR "valid_to" > "valid_from");
  END IF;

  -- A blank reference passes a VARCHAR check and is not a reference.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'job_work_agreements_reference_not_blank') THEN
    ALTER TABLE "job_work_agreements" ADD CONSTRAINT "job_work_agreements_reference_not_blank"
      CHECK ("agreement_reference" IS NULL OR length(btrim("agreement_reference")) > 0);
  END IF;

  -- The brand name is what the carton says. Blank is not a brand.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'job_work_product_mappings_brand_not_blank') THEN
    ALTER TABLE "job_work_product_mappings" ADD CONSTRAINT "job_work_product_mappings_brand_not_blank"
      CHECK (length(btrim("principal_brand_name")) > 0);
  END IF;
END
$$;

-- -----------------------------------------------------------------------------
-- 6. Row-Level Security
-- -----------------------------------------------------------------------------

ALTER TABLE "job_work_agreements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "job_work_agreements" FORCE ROW LEVEL SECURITY;
ALTER TABLE "job_work_product_mappings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "job_work_product_mappings" FORCE ROW LEVEL SECURITY;

DO $rls$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['job_work_agreements', 'job_work_product_mappings'] LOOP
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
-- 7. No hard deletes on the agreement
-- -----------------------------------------------------------------------------
-- The agreement that governed a batch made last year is part of that batch's
-- commercial record. Its mapping lines are NOT protected: they cascade from the
-- agreement, and blocking DELETE there would make the agreement uneditable.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'job_work_agreements'::regclass AND tgname = 'job_work_agreements_no_hard_delete'
  ) THEN
    CREATE TRIGGER "job_work_agreements_no_hard_delete"
      BEFORE DELETE ON "job_work_agreements"
      FOR EACH ROW EXECUTE FUNCTION public.prevent_hard_delete();
  END IF;
END
$$;

-- -----------------------------------------------------------------------------
-- 8. Privileges for the runtime role
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

  FOREACH v_table IN ARRAY ARRAY['job_work_agreements', 'job_work_product_mappings'] LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I TO %I', v_table, v_role);
  END LOOP;
END
$grants$;
