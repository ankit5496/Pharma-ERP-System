-- =============================================================================
-- Order-to-Cash: the customer register
-- =============================================================================
-- Customers are PARTIES, not a second master. parties.controller.ts already
-- states the rule this follows: "suppliers and customers ... are one table: a
-- distributor that also supplies cartons is a single legal entity". A separate
-- `customers` table would give that distributor two codes, two credit limits
-- and two audit trails, and nothing would keep them agreeing.
--
-- So this migration EXTENDS `parties` with the columns Order-to-Cash needs and
-- adds one child table for the licence register. It creates no second customer
-- master and drops nothing.
--
-- Why a child table for licences rather than more columns: a distributor holds
-- several licences at once (a retail 20B and a wholesale 21B, sometimes a
-- Schedule X endorsement), each with its own number, authority and expiry. The
-- existing parties.drug_licence_number / drug_licence_valid_to pair holds ONE,
-- and US-MD-02's CHECK constraint depends on it, so it is left exactly as it
-- is — this table sits alongside it and carries the full register.
--
-- NOTE: `licences` (LicenceType) is the COMPANY'S OWN licence register. This is
-- the customer's, which is a different question asked of a different party.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Vocabulary
-- -----------------------------------------------------------------------------

CREATE TYPE "CustomerType" AS ENUM (
  'DISTRIBUTOR',
  'STOCKIST',
  'WHOLESALER',
  'RETAIL_CHAIN',
  'HOSPITAL',
  'GOVERNMENT',
  'EXPORT',
  'OTHER'
);

CREATE TYPE "CustomerLicenceCategory" AS ENUM ('RETAIL', 'WHOLESALE', 'MANUFACTURING', 'OTHER');

-- The licence's REGULATORY STANDING, not its freshness. Whether it is still in
-- date is derived from expiry_date at read time; this records whether the
-- issuing authority has suspended or cancelled it. A licence can be well inside
-- its validity window and still be SUSPENDED.
CREATE TYPE "CustomerLicenceStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'CANCELLED');

-- BLOCKED is a commercial hold — credit stopped, licence lapsed — and is
-- distinct from INACTIVE, which means the account is simply not in use. The
-- order gate treats them differently, so they cannot collapse into one value.
--
-- Added, never used, in this migration: PostgreSQL forbids using a new enum
-- label in the same transaction that adds it.
ALTER TYPE "PartyStatus" ADD VALUE IF NOT EXISTS 'BLOCKED';

-- -----------------------------------------------------------------------------
-- 2. Order-to-Cash columns on the party register
-- -----------------------------------------------------------------------------
-- All nullable. Every existing party — including the vendors Procure-to-Pay
-- created — stays valid without a backfill, and a row only carries these once
-- somebody fills the customer screen in.

ALTER TABLE "parties"
  ADD COLUMN IF NOT EXISTS "customer_type"   "CustomerType",
  ADD COLUMN IF NOT EXISTS "contact_person"  VARCHAR(255),
  -- Its first two digits set the place of supply, which decides IGST vs
  -- CGST+SGST. Kept separate from the GSTIN because a customer without a GSTIN
  -- still has a state.
  ADD COLUMN IF NOT EXISTS "state_code"      VARCHAR(2),
  ADD COLUMN IF NOT EXISTS "billing_line1"   VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "billing_line2"   VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "billing_city"    VARCHAR(120),
  ADD COLUMN IF NOT EXISTS "billing_state"   VARCHAR(120),
  ADD COLUMN IF NOT EXISTS "billing_pin"     VARCHAR(10),
  -- Shipping is held separately because goods and paperwork diverge: a
  -- distributor bills to a head office and receives at a warehouse, and the
  -- despatch note has to name the place that physically receives the stock.
  ADD COLUMN IF NOT EXISTS "shipping_line1"  VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "shipping_line2"  VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "shipping_city"   VARCHAR(120),
  ADD COLUMN IF NOT EXISTS "shipping_state"  VARCHAR(120),
  ADD COLUMN IF NOT EXISTS "shipping_pin"    VARCHAR(10),
  ADD COLUMN IF NOT EXISTS "notes"           VARCHAR(1000);

-- The customer list is filtered by type and sorted by name.
CREATE INDEX IF NOT EXISTS "parties_tenant_id_customer_type_idx"
  ON "parties" ("tenant_id", "customer_type");

-- -----------------------------------------------------------------------------
-- 3. The customer licence register
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "customer_licences" (
  "id"        UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "party_id"  UUID NOT NULL,

  "licence_number"    VARCHAR(64) NOT NULL,
  "category"          "CustomerLicenceCategory" NOT NULL,
  -- "20B", "21B" — the form the licence was granted on.
  "form_number"       VARCHAR(32),
  "issuing_authority" VARCHAR(255),

  -- Dates, not timestamps: a licence is valid for a day in the issuing
  -- authority's calendar. Storing an instant would make validity depend on the
  -- reader's timezone, which is how a sale gets refused an hour early.
  "issue_date"  DATE NOT NULL,
  "expiry_date" DATE NOT NULL,

  "status" "CustomerLicenceStatus" NOT NULL DEFAULT 'ACTIVE',

  -- Schedule X needs a specific endorsement; holding a wholesale licence is not
  -- enough. The allocation gate reads this flag directly.
  "covers_schedule_x" BOOLEAN NOT NULL DEFAULT FALSE,

  -- The one the order gate tests when it needs a single answer.
  "is_primary" BOOLEAN NOT NULL DEFAULT FALSE,

  "notes" VARCHAR(1000),

  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  "deleted_at" TIMESTAMPTZ(6),

  CONSTRAINT "customer_licences_pkey" PRIMARY KEY ("id"),
  -- A licence cannot expire before it was issued. Cheap to state, and it
  -- catches a transposed pair of dates at the point of entry.
  CONSTRAINT "customer_licences_expiry_after_issue" CHECK ("expiry_date" >= "issue_date")
);

-- The same licence number cannot be recorded twice for one customer. Scoped to
-- the tenant because two tenants may legitimately trade with the same firm.
CREATE UNIQUE INDEX IF NOT EXISTS "customer_licences_tenant_party_number_key"
  ON "customer_licences" ("tenant_id", "party_id", "licence_number");

-- At most ONE primary licence per customer. A partial index rather than a
-- constraint, so the rule binds only the rows claiming primacy and a soft
-- deleted row stops competing.
CREATE UNIQUE INDEX IF NOT EXISTS "customer_licences_one_primary_per_party"
  ON "customer_licences" ("tenant_id", "party_id")
  WHERE "is_primary" AND "deleted_at" IS NULL;

-- Drives the expiry warning strip.
CREATE INDEX IF NOT EXISTS "customer_licences_tenant_expiry_idx"
  ON "customer_licences" ("tenant_id", "expiry_date");

ALTER TABLE "customer_licences"
  ADD CONSTRAINT "customer_licences_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RESTRICT, not CASCADE: a customer with licences on file cannot be hard
-- deleted out from under them. Retirement is a soft delete on the party.
ALTER TABLE "customer_licences"
  ADD CONSTRAINT "customer_licences_party_id_fkey"
  FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- 4. Tenant isolation
-- -----------------------------------------------------------------------------

ALTER TABLE "customer_licences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "customer_licences" FORCE ROW LEVEL SECURITY;

DO $rls$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['customer_licences'] LOOP
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
-- 5. Privileges for the runtime role
-- -----------------------------------------------------------------------------

DO $grants$
DECLARE
  v_role text := 'pharma_app';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
    RAISE NOTICE 'Role % not present; skipping runtime grants.', v_role;
    RETURN;
  END IF;

  -- DELETE included: a licence recorded against the wrong customer is a typo to
  -- withdraw, not a historical fact to preserve. The service soft deletes.
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I TO %I', 'customer_licences', v_role);
END
$grants$;

-- -----------------------------------------------------------------------------
-- 6. Assert nothing was missed
-- -----------------------------------------------------------------------------
-- A tenant-scoped table without RLS is a cross-tenant leak that no application
-- test would catch, because the application filters by tenant too.

DO $verify$
DECLARE
  v_unprotected text;
BEGIN
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname)
  INTO v_unprotected
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_attribute a ON a.attrelid = c.oid
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND a.attname = 'tenant_id'
    AND a.attnum > 0
    AND NOT a.attisdropped
    AND (c.relrowsecurity IS FALSE OR c.relforcerowsecurity IS FALSE);

  IF v_unprotected IS NOT NULL THEN
    RAISE EXCEPTION 'Tables carry tenant_id but lack ENABLE/FORCE row level security: %', v_unprotected
      USING HINT = 'Add the table to the tenant-isolation loop in this migration.';
  END IF;
END
$verify$;
