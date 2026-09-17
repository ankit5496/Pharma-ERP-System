-- =============================================================================
-- Licence & Compliance register (US-MD-04)
-- =============================================================================
-- The company's OWN statutory permissions, and the lead time on the alert that
-- warns before one lapses.
--
-- Not to be confused with `parties.drug_licence_number`, which is somebody
-- else's licence recorded against their party row. This table is the
-- manufacturer's own paperwork.
--
-- The two acceptance criteria, and where each is actually enforced:
--
--   "A dashboard alert must fire a configurable number of days (default 60)
--    before any stored license expires."
--      -> tenants.licence_alert_lead_days, below. A column rather than a
--         constant is what makes it configurable; the sweep itself lives in
--         DashboardService because "fire an alert" is a read, not an invariant.
--
--   "License records must only be visible to Admin and Quality/Compliance
--    roles."
--      -> NOT here. Row-level security isolates tenants from each other and
--         knows nothing about application roles — every role in a company
--         connects as the same `pharma_app` user, so a policy could not tell
--         an Admin from a Store Officer. That criterion is enforced by
--         @Roles('ADMIN', 'QUALITY_OFFICER') on the licences controller, and
--         the RLS below does the job it can actually do.
--
-- Written with IF NOT EXISTS guards throughout, matching
-- 20260911150000_party_master_compliance: the hosted database and a fresh
-- local one are in different states, and one file has to bring either to the
-- same place.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. The alert threshold
-- -----------------------------------------------------------------------------
-- Per company, defaulting to the 60 days the criterion specifies. Existing
-- tenants pick up the default, so the alert works for them without anyone
-- configuring anything.

ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "licence_alert_lead_days" INTEGER NOT NULL DEFAULT 60;

-- A zero-day lead time would mean "tell me once it has already expired", which
-- is not a warning. The upper bound stops a typo (600 instead of 60) turning
-- every licence on file into a permanent alert.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenants_licence_alert_lead_days_sane') THEN
    ALTER TABLE "tenants" ADD CONSTRAINT "tenants_licence_alert_lead_days_sane"
      CHECK ("licence_alert_lead_days" BETWEEN 1 AND 365);
  END IF;
END
$$;

-- -----------------------------------------------------------------------------
-- 2. Enum
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'LicenceType') THEN
    CREATE TYPE "LicenceType" AS ENUM ('MANUFACTURING', 'GST_REGISTRATION', 'NARCOTICS');
  END IF;
END
$$;

-- -----------------------------------------------------------------------------
-- 3. Table
-- -----------------------------------------------------------------------------
-- issued_on and expiry_date are DATE, not TIMESTAMPTZ. A licence is valid for a
-- day in the issuing authority's calendar; storing an instant would make
-- "expires today" depend on who is reading and from which timezone.

CREATE TABLE IF NOT EXISTS "licences" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "licence_type" "LicenceType" NOT NULL,
    "licence_number" VARCHAR(64) NOT NULL,
    "issuing_authority" VARCHAR(255) NOT NULL,
    "issued_on" DATE,
    "expiry_date" DATE NOT NULL,
    "notes" VARCHAR(1000),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "licences_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'licences_tenant_id_fkey') THEN
    ALTER TABLE "licences" ADD CONSTRAINT "licences_tenant_id_fkey"
      FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$$;

-- -----------------------------------------------------------------------------
-- 4. Indexes
-- -----------------------------------------------------------------------------

-- One live record per licence number of a given type. A renewal moves the
-- expiry date on the existing row; it does not add a second row that nobody can
-- tell from the first.
CREATE UNIQUE INDEX IF NOT EXISTS "licences_tenant_id_licence_type_licence_number_key"
  ON "licences"("tenant_id", "licence_type", "licence_number");

-- The expiry sweep runs on every dashboard load, filtered to one tenant and
-- ordered by date. This is the index that keeps it off a sequential scan.
CREATE INDEX IF NOT EXISTS "licences_tenant_id_expiry_date_deleted_at_idx"
  ON "licences"("tenant_id", "expiry_date", "deleted_at");

-- -----------------------------------------------------------------------------
-- 5. Invariants
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  -- A blank licence number passes NOT NULL and is worthless on a document.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'licences_licence_number_not_blank') THEN
    ALTER TABLE "licences" ADD CONSTRAINT "licences_licence_number_not_blank"
      CHECK (length(btrim("licence_number")) > 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'licences_issuing_authority_not_blank') THEN
    ALTER TABLE "licences" ADD CONSTRAINT "licences_issuing_authority_not_blank"
      CHECK (length(btrim("issuing_authority")) > 0);
  END IF;

  -- A licence that expired before it was issued is a data-entry error, and it
  -- would sit in the alert list for ever.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'licences_expiry_after_issue') THEN
    ALTER TABLE "licences" ADD CONSTRAINT "licences_expiry_after_issue"
      CHECK ("issued_on" IS NULL OR "expiry_date" > "issued_on");
  END IF;
END
$$;

-- -----------------------------------------------------------------------------
-- 6. Row-Level Security
-- -----------------------------------------------------------------------------
-- Tenant isolation only — see the header for why the role restriction is not
-- here. ENABLE and FORCE so the table owner is bound by the policy too.

ALTER TABLE "licences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "licences" FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'licences'
      AND policyname = 'licences_tenant_isolation'
  ) THEN
    CREATE POLICY "licences_tenant_isolation" ON "licences"
      FOR ALL
      USING ("tenant_id" = public.current_tenant_id())
      WITH CHECK ("tenant_id" = public.require_tenant_id());
  END IF;
END
$$;

-- -----------------------------------------------------------------------------
-- 7. No hard deletes
-- -----------------------------------------------------------------------------
-- A licence that covered a batch made last year is part of that batch's
-- compliance record. Retiring it from the register must not remove the evidence
-- that production was lawful at the time.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'licences'::regclass AND tgname = 'licences_no_hard_delete'
  ) THEN
    CREATE TRIGGER "licences_no_hard_delete"
      BEFORE DELETE ON "licences"
      FOR EACH ROW EXECUTE FUNCTION public.prevent_hard_delete();
  END IF;
END
$$;

-- -----------------------------------------------------------------------------
-- 8. Privileges for the runtime role
-- -----------------------------------------------------------------------------
-- A no-op when the role does not exist yet, which is the case on a managed
-- database where scripts/render-bootstrap.sql runs after the migrations.
--
-- DELETE is granted even though the trigger above refuses every hard delete:
-- the grant is what the trigger gets the chance to refuse, and without it the
-- failure would be a permissions error rather than the written explanation
-- prevent_hard_delete() raises.

DO $grants$
DECLARE
  v_role text := 'pharma_app';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
    RAISE NOTICE 'Role % not present; skipping runtime grants.', v_role;
    RETURN;
  END IF;

  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "licences" TO %I', v_role);
END
$grants$;
