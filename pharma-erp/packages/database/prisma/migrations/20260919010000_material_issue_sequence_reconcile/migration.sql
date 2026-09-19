-- =============================================================================
-- document_sequences: carrying the material-issue counter onto its new key
-- =============================================================================
-- MaterialIssueService used to allocate from a counter keyed `MI-${year}` —
-- the year in the doc_type AND again in its own column. It now allocates
-- through NumberingService, whose key is the plain prefix 'MI' with the year
-- beside it, matching every other series.
--
-- The code changed; the rows did not. So a tenant that had already dispensed
-- material had a counter at `('MI-2026', 2026)` sitting at 4, and the new code
-- looked for `('MI', 2026)`, found nothing, and took the create path — handing
-- out MI-2026-0001 again. That number already existed, so the unique index on
-- (tenant_id, issue_number) refused the insert and dispensing died with a 500.
--
-- This renames the key, per tenant and year, preserving next_value. It is a
-- rename rather than a reset because the numbers already issued are on paper:
-- restarting the series would hand out MI-2026-0001 a second time.
--
-- IDEMPOTENT AND ORDER-SAFE. If a tenant somehow has both keys, the surviving
-- row takes the HIGHER next_value — never the lower, which would re-issue a
-- number — and the stale row is dropped. A tenant with only the new key, or
-- with neither, is untouched.
--
-- WHY NOT JUST DELETE THE OLD ROW: the next allocation would then start at 1
-- and collide with MI-2026-0001 all over again. The value is the whole point.
--
-- Scoped to 'MI'. `BATCH-YYMM` is deliberately templated — batch numbers run a
-- MONTHLY series with a tenant-configured prefix, outside NumberingService —
-- and must not be touched.
-- =============================================================================

-- ONE PASS PER TENANT, with `app.current_tenant_id` set each time.
--
-- `document_sequences` carries FORCE ROW LEVEL SECURITY, and the migration
-- role owns the table — force applies to owners, and there is no BYPASSRLS on
-- the managed database. A plain UPDATE here therefore matches ZERO rows and
-- reports success, which is exactly how the first version of this migration
-- appeared to run and changed nothing. Setting the tenant per iteration is
-- what makes the rows visible; see 20260917000000_material_issue_number for
-- the same problem and the same shape of fix.
DO $reconcile$
DECLARE
  v_tenant uuid;
BEGIN
  FOR v_tenant IN SELECT "id" FROM "tenants" LOOP
    PERFORM set_config('app.current_tenant_id', v_tenant::text, true);

    -- Fold a legacy counter into the new key, keeping whichever value is
    -- further along. GREATEST covers a tenant that somehow has both rows —
    -- never the lower value, which would re-issue a number already on paper.
    UPDATE "document_sequences" AS target
    SET "next_value" = GREATEST(target."next_value", legacy."next_value")
    FROM "document_sequences" AS legacy
    WHERE legacy."tenant_id" = target."tenant_id"
      AND legacy."year" = target."year"
      AND legacy."doc_type" = 'MI-' || target."year"::text
      AND target."doc_type" = 'MI';

    -- Rename the rest: a legacy counter whose new key does not exist yet.
    UPDATE "document_sequences" AS legacy
    SET "doc_type" = 'MI'
    WHERE legacy."doc_type" = 'MI-' || legacy."year"::text
      AND NOT EXISTS (
        SELECT 1 FROM "document_sequences" AS existing
        WHERE existing."tenant_id" = legacy."tenant_id"
          AND existing."year" = legacy."year"
          AND existing."doc_type" = 'MI'
      );

    -- Anything still on the old key was folded into a new one above.
    DELETE FROM "document_sequences"
    WHERE "doc_type" = 'MI-' || "year"::text;
  END LOOP;
END
$reconcile$;
