-- US-PROD-02: "Issue No. (auto-generated)".
--
-- A dispensing record is a document somebody writes on a slip and carries to
-- the shop floor. Until now it had only a UUID, so there was nothing a store
-- officer could quote — "the issue at 14:32 against WO-2026-0003" is not a
-- reference anyone can use.
--
-- Added NULLable, backfilled, then made NOT NULL: the column is required going
-- forward, and a table with rows in it cannot gain a NOT NULL column in one
-- step without a default that would be wrong for every existing row.
ALTER TABLE "material_issues" ADD COLUMN "issue_number" VARCHAR(32);

-- THE FORCE FLAG COMES OFF FOR THE BACKFILL, and it has to.
--
-- `material_issues` carries FORCE ROW LEVEL SECURITY with a policy of
-- `tenant_id = current_tenant_id()`. A migration runs with no tenant context,
-- so that function returns NULL and the policy hides EVERY row. Two things
-- that would normally get round this do not work here:
--
--   The table OWNER is still subject to the policy — that is exactly what the
--   force flag means, and it is deliberate: these policies are the tenant
--   boundary, not a convenience.
--
--   BYPASSRLS is not granted to the role Render gives us, so SECURITY DEFINER
--   changes nothing either.
--
-- What the owner may do is set the tenant context, one tenant at a time, and
-- let the policy be satisfied HONESTLY rather than switched off. That also
-- keeps the policy's WITH CHECK clause happy: it calls `require_tenant_id()`,
-- which RAISES when the setting is absent, so relaxing the read side alone
-- would still have refused the write.
DO $backfill$
DECLARE
  v_tenant uuid;
BEGIN
  FOR v_tenant IN SELECT id FROM tenants LOOP
    PERFORM set_config('app.current_tenant_id', v_tenant::text, true);

    -- Numbered per calendar year of the issue, in the order they were actually
    -- made. The same MI-YYYY-NNNN shape the application allocates from
    -- `document_sequences`, so backfilled numbers and ones issued from
    -- tomorrow read as a single series.
    WITH numbered AS (
      SELECT
        id,
        EXTRACT(YEAR FROM issued_at)::int AS issue_year,
        ROW_NUMBER() OVER (
          PARTITION BY EXTRACT(YEAR FROM issued_at)
          ORDER BY issued_at, id
        ) AS seq
      FROM material_issues
      WHERE issue_number IS NULL
    )
    UPDATE material_issues AS mi
       SET issue_number = 'MI-' || numbered.issue_year || '-' || LPAD(numbered.seq::text, 4, '0')
      FROM numbered
     WHERE mi.id = numbered.id;

    -- The sequence has to continue from the backfill rather than restarting at
    -- 1, or the first issue made after this migration would collide with an
    -- existing row. `next_value` is the number the NEXT document takes.
    INSERT INTO document_sequences ("id", "tenant_id", "doc_type", "year", "next_value")
    SELECT
      gen_random_uuid(),
      v_tenant,
      'MI-' || EXTRACT(YEAR FROM issued_at)::int,
      EXTRACT(YEAR FROM issued_at)::int,
      COUNT(*) + 1
    FROM material_issues
    GROUP BY EXTRACT(YEAR FROM issued_at)
    ON CONFLICT ("tenant_id", "doc_type", "year") DO NOTHING;
  END LOOP;

  -- Left unset so nothing after this point inherits a tenant by accident.
  PERFORM set_config('app.current_tenant_id', '', true);
END
$backfill$;

ALTER TABLE "material_issues" ALTER COLUMN "issue_number" SET NOT NULL;

-- Per tenant, not globally: two companies numbering their own documents must
-- not collide, and one company must never reuse a number.
CREATE UNIQUE INDEX "material_issues_tenant_id_issue_number_key"
    ON "material_issues" ("tenant_id", "issue_number");
