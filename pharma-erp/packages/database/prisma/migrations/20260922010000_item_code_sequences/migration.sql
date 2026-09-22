-- =============================================================================
-- Item codes become a per-category sequence
-- =============================================================================
-- The item code used to be typed, and the register ended up holding "pcm-500",
-- "PCM- 500", "PCM 500" and "PCM-500" as four separate items, alongside bare
-- numbers like 1001 and 1003 carrying no category at all. It is now allocated
-- by the server as RM-00001 / PM-00001 / SF-00001 / FG-00001, from a counter
-- per category.
--
-- SEEDED ABOVE WHAT IS ALREADY THERE, per tenant. Existing codes reach
-- RM-0421, PM-1013 and FG-4010, so a counter starting at 1 would hand out
-- RM-00001 next — unique, but leaving the register reading as two eras with
-- low numbers newer than high ones. Starting past the highest keeps one
-- ascending series.
--
-- ONLY WELL-FORMED CODES COUNT toward the high-water mark: `^(RM|PM|SF|FG)-?
-- [0-9]+$`. "PCM-500" is not an RM code however it looks, and "1001" has no
-- prefix to belong to — neither should push a counter forward.
--
-- YEAR 0 IS A SENTINEL. `document_sequences` keys on (tenant, doc_type, year)
-- because every series it was built for restarts each January; an item code
-- does not, since RM-00412 is the four-hundred-and-twelfth raw material this
-- company has ever recorded. 0 means "not year-scoped" and cannot collide with
-- a real year.
--
-- PER TENANT, with `app.current_tenant_id` set each pass: both tables carry
-- FORCE ROW LEVEL SECURITY and a migration runs as the table owner with no
-- BYPASSRLS, so a plain statement here matches zero rows and reports success.
-- =============================================================================

DO $seed$
DECLARE
  v_tenant uuid;
  v_prefix text;
  v_next   int;
BEGIN
  FOR v_tenant IN SELECT "id" FROM "tenants" LOOP
    PERFORM set_config('app.current_tenant_id', v_tenant::text, true);

    FOREACH v_prefix IN ARRAY ARRAY['RM', 'PM', 'SF', 'FG'] LOOP
      -- One past the highest serial already in use for this prefix, or 1 when
      -- the category is empty.
      SELECT COALESCE(MAX((substring("code" from '[0-9]+$'))::int), 0) + 1
        INTO v_next
        FROM "items"
       WHERE "code" ~ ('^' || v_prefix || '-?[0-9]+$');

      -- `id` is generated explicitly: @default(uuid()) is a PRISMA default,
      -- applied by the client, and the column carries no database default —
      -- so an INSERT from SQL has to supply one or fail on the NOT NULL.
      INSERT INTO "document_sequences" ("id", "tenant_id", "doc_type", "year", "next_value")
      VALUES (gen_random_uuid(), v_tenant, v_prefix, 0, v_next)
      -- Left alone if it already exists: a counter that has started handing out
      -- codes must not be rewound, and this migration re-running must not undo
      -- whatever it has reached.
      ON CONFLICT ("tenant_id", "doc_type", "year") DO NOTHING;
    END LOOP;
  END LOOP;
END
$seed$;
