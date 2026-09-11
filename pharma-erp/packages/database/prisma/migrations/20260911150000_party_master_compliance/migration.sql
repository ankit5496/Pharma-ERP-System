-- =============================================================================
-- Party master: the compliance and credit fields (US-MD-02)
-- =============================================================================
-- The `parties` table already exists. It was created by the Procure-to-Pay
-- work, whose migrations live on the shared database but not in this
-- repository, and purchase orders, goods receipts and invoices already
-- reference it. So this ADDS to that table rather than defining its own.
--
-- WHY THIS FILE IS IDEMPOTENT, which is not how migrations are normally
-- written: the two databases are in genuinely different states. The hosted
-- one has `parties` from a migration this repo has never seen; a fresh local
-- one has nothing. Guarding every statement lets one file bring either to the
-- same place, and lets `migrate reset` work locally without the P2P
-- migrations being present. Drop the guards once the two histories are
-- reconciled in one repository.
--
-- The acceptance criterion this exists to make true:
--
--   "A customer record cannot be marked as active for sale unless a drug
--    license number and validity date are on file."
--
-- That is `parties_active_customer_is_licensed`. A CHECK constraint, not a
-- service rule — dispatching to an unlicensed buyer has to be impossible
-- rather than merely discouraged.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. The table as Procure-to-Pay defined it
-- -----------------------------------------------------------------------------
-- A no-op on the hosted database. On a fresh local one this reproduces their
-- shape exactly — column names, nullability and defaults all theirs, so the
-- two databases cannot drift apart through this file.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PartyType') THEN
    CREATE TYPE "PartyType" AS ENUM ('VENDOR', 'CUSTOMER', 'JOB_WORK_PRINCIPAL');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS "parties" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "party_type" "PartyType" NOT NULL DEFAULT 'VENDOR',
    "gstin" VARCHAR(15),
    "drug_licence_number" VARCHAR(64),
    "email" VARCHAR(320),
    "phone" VARCHAR(32),
    "address" VARCHAR(1000),
    "payment_terms_days" INTEGER NOT NULL DEFAULT 30,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "parties_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'parties_tenant_id_fkey') THEN
    ALTER TABLE "parties" ADD CONSTRAINT "parties_tenant_id_fkey"
      FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS "parties_tenant_id_code_key" ON "parties"("tenant_id", "code");
CREATE INDEX IF NOT EXISTS "parties_tenant_id_party_type_deleted_at_idx" ON "parties"("tenant_id", "party_type", "deleted_at");

-- Tenant isolation and the no-hard-delete guard, if they are not already on.
ALTER TABLE "parties" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "parties" FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'parties'
      AND policyname = 'parties_tenant_isolation'
  ) THEN
    CREATE POLICY "parties_tenant_isolation" ON "parties"
      FOR ALL
      USING ("tenant_id" = public.current_tenant_id())
      WITH CHECK ("tenant_id" = public.require_tenant_id());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'parties'::regclass AND tgname = 'parties_no_hard_delete'
  ) THEN
    CREATE TRIGGER "parties_no_hard_delete"
      BEFORE DELETE ON "parties"
      FOR EACH ROW EXECUTE FUNCTION public.prevent_hard_delete();
  END IF;
END
$$;

-- -----------------------------------------------------------------------------
-- 2. What US-MD-02 adds
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PartyStatus') THEN
    CREATE TYPE "PartyStatus" AS ENUM ('ACTIVE', 'INACTIVE');
  END IF;
END
$$;

ALTER TABLE "parties"
  ADD COLUMN IF NOT EXISTS "status" "PartyStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS "drug_licence_valid_to" DATE,
  ADD COLUMN IF NOT EXISTS "credit_limit" DECIMAL(14,2),
  ADD COLUMN IF NOT EXISTS "credit_period_days" INTEGER;

-- Supports the renewal sweep: whose licence lapses next.
CREATE INDEX IF NOT EXISTS "parties_tenant_id_drug_licence_valid_to_idx"
  ON "parties"("tenant_id", "drug_licence_valid_to");

-- -----------------------------------------------------------------------------
-- 3. Invariants
-- -----------------------------------------------------------------------------
-- `ADD CONSTRAINT` has no IF NOT EXISTS, so each is guarded by name.

DO $$
BEGIN
  -- US-MD-02. Reads as: a party that is not a customer is unaffected; an
  -- INACTIVE customer may be recorded with the licence still to come — which
  -- is what lets someone enter the party today and activate it when the
  -- paperwork arrives; an ACTIVE customer must have both.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'parties_active_customer_is_licensed') THEN
    ALTER TABLE "parties" ADD CONSTRAINT "parties_active_customer_is_licensed"
      CHECK (
        "party_type" <> 'CUSTOMER'
        OR "status" <> 'ACTIVE'
        OR ("drug_licence_number" IS NOT NULL AND "drug_licence_valid_to" IS NOT NULL)
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'parties_credit_limit_non_negative') THEN
    ALTER TABLE "parties" ADD CONSTRAINT "parties_credit_limit_non_negative"
      CHECK ("credit_limit" IS NULL OR "credit_limit" >= 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'parties_credit_period_non_negative') THEN
    ALTER TABLE "parties" ADD CONSTRAINT "parties_credit_period_non_negative"
      CHECK ("credit_period_days" IS NULL OR "credit_period_days" >= 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'parties_payment_terms_days_non_negative') THEN
    ALTER TABLE "parties" ADD CONSTRAINT "parties_payment_terms_days_non_negative"
      CHECK ("payment_terms_days" >= 0);
  END IF;

  -- The statutory format, checked only when a GSTIN is given: an unregistered
  -- small supplier genuinely has none, and their column is nullable.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'parties_gstin_format') THEN
    ALTER TABLE "parties" ADD CONSTRAINT "parties_gstin_format"
      CHECK ("gstin" IS NULL OR "gstin" ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'parties_name_not_blank') THEN
    ALTER TABLE "parties" ADD CONSTRAINT "parties_name_not_blank"
      CHECK (length(btrim("name")) > 0);
  END IF;
END
$$;
