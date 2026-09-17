-- =============================================================================
-- material_issues.issue_number — reconciling a drift that was breaking writes
-- =============================================================================
-- The hosted database already has this column: NOT NULL VARCHAR(32) with a
-- unique index on (tenant_id, issue_number), added by a migration recorded in
-- `_prisma_migrations` as `20260917000000_material_issue_number` but never
-- present in this repository. `schema.prisma` therefore did not know about it,
-- so the Prisma client issued every INSERT into `material_issues` without it —
-- and Postgres rejected each one on the NOT NULL.
--
-- The symptom was a 500 on every attempt to dispense material, and the proof is
-- that `material_issues` contained zero rows: not one issue had ever succeeded
-- against that database.
--
-- This migration makes a FRESH database match the hosted one, so the two stop
-- disagreeing. On the hosted database every statement here is a no-op, which is
-- the point of the guards.
--
-- The application half of the fix is in MaterialIssueService, which now
-- allocates MI-YYYY-NNNN through NumberingService like every other document.
-- =============================================================================

ALTER TABLE "material_issues" ADD COLUMN IF NOT EXISTS "issue_number" VARCHAR(32);

-- Backfill before the NOT NULL, for any database that has rows and no numbers.
-- Numbered by creation order within a tenant and year, which is what the series
-- would have produced had it existed when they were written.
UPDATE "material_issues" AS m
SET "issue_number" = n."number"
FROM (
  SELECT
    "id",
    'MI-' || to_char("created_at", 'YYYY') || '-' ||
      lpad(
        row_number() OVER (
          PARTITION BY "tenant_id", date_part('year', "created_at")
          ORDER BY "created_at", "id"
        )::text,
        4,
        '0'
      ) AS "number"
  FROM "material_issues"
  WHERE "issue_number" IS NULL
) AS n
WHERE m."id" = n."id" AND m."issue_number" IS NULL;

ALTER TABLE "material_issues" ALTER COLUMN "issue_number" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "material_issues_tenant_id_issue_number_key"
  ON "material_issues"("tenant_id", "issue_number");
