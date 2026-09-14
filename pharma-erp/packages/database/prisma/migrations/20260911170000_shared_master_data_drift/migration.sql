-- Reconciles the shared Render database back into the migration history.
--
-- WHY THIS EXISTS. Render is the source of truth for this project and several
-- people work against the one instance. Columns were added there to `items`
-- and `parties` outside this repository's migrations, so a database built from
-- these migrations alone would come out DIFFERENT from the one everybody
-- actually develops against — which is the drift that eventually presents as
-- an inexplicable Prisma error on somebody else's machine.
--
-- This migration adds nothing new. Every statement is written IF NOT EXISTS so
-- that on Render — where all of it is already true — it is a no-op, while on a
-- fresh database it reproduces what Render has. The Prisma schema is updated
-- to match in the same commit, so `migrate diff` comes back empty afterwards.
--
-- It changes NO behaviour. `requires_batch_tracking` defaults to true, which is
-- exactly what the application already assumed unconditionally, and the rest
-- are nullable additions nothing reads yet.

-- -----------------------------------------------------------------------------
-- 1. items
-- -----------------------------------------------------------------------------

ALTER TABLE "items"
  -- Whether receipt demands a vendor batch number and expiry. The application
  -- has always required both; this makes the rule data rather than an
  -- assumption, and the default preserves today's behaviour exactly.
  ADD COLUMN IF NOT EXISTS "requires_batch_tracking" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "notes" VARCHAR(1000);

-- -----------------------------------------------------------------------------
-- 2. parties
-- -----------------------------------------------------------------------------

DO $party_status$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PartyStatus') THEN
    CREATE TYPE "PartyStatus" AS ENUM ('ACTIVE', 'INACTIVE');
  END IF;
END
$party_status$;

ALTER TABLE "parties"
  -- Distinct from the soft delete: an INACTIVE vendor is one you have stopped
  -- buying from but whose history must stay intact and readable.
  ADD COLUMN IF NOT EXISTS "status" "PartyStatus" NOT NULL DEFAULT 'ACTIVE',
  -- A pharmaceutical vendor's drug licence expires, and buying from an expired
  -- one is a regulatory finding. Indexed below so "whose licence lapses soon"
  -- is a cheap question.
  ADD COLUMN IF NOT EXISTS "drug_licence_valid_to" DATE,
  ADD COLUMN IF NOT EXISTS "credit_limit" NUMERIC(14, 2),
  ADD COLUMN IF NOT EXISTS "credit_period_days" INTEGER;

CREATE INDEX IF NOT EXISTS "parties_tenant_id_drug_licence_valid_to_idx"
  ON "parties" ("tenant_id", "drug_licence_valid_to");

-- -----------------------------------------------------------------------------
-- 3. Assertion
-- -----------------------------------------------------------------------------

DO $verify$
DECLARE
  v_missing TEXT;
BEGIN
  SELECT string_agg(required.expected, ', ')
    INTO v_missing
    FROM (
      VALUES
        ('items.requires_batch_tracking'),
        ('items.notes'),
        ('parties.status'),
        ('parties.drug_licence_valid_to'),
        ('parties.credit_limit'),
        ('parties.credit_period_days')
    ) AS required(expected)
   WHERE NOT EXISTS (
     SELECT 1
       FROM information_schema.columns c
      WHERE c.table_schema = 'public'
        AND c.table_name = split_part(required.expected, '.', 1)
        AND c.column_name = split_part(required.expected, '.', 2)
   );

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'Master-data reconciliation did not apply cleanly; missing: %', v_missing;
  END IF;
END
$verify$;
