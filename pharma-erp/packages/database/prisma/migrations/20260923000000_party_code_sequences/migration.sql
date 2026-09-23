-- =============================================================================
-- Party codes become a per-type sequence
-- =============================================================================
-- The party code used to be typed, and the register ended up holding "SUP-0001",
-- "SUP-001" and "V-1001" for vendors, "C-3001", "DIST-002" and "PAR-001" for
-- customers, and job-work principals filed under "SUP-008" — a supplier prefix
-- on a party that is not a supplier. It is now allocated by the server as
-- VEN-00001 / CUS-00001 / PRI-00001, from a counter per party type.
--
-- THE OLD CODES ARE LEFT ALONE. They are quoted on purchase orders, invoices
-- and agreements already raised, and rewriting them would make those documents
-- cite a party code that no longer exists. The register will read as two eras
-- for a while; that is the honest outcome, and the alternative is worse.
--
-- SEEDED ABOVE WHAT IS ALREADY THERE, per tenant, on the same high-water-mark
-- rule the item codes use. No party in any tenant currently carries a VEN-,
-- CUS- or PRI- code, so every counter starts at 1 today — the MAX() is here so
-- that a tenant which does have them cannot be handed a duplicate.
--
-- ONLY WELL-FORMED CODES COUNT toward that mark: `^(VEN|CUS|PRI)-?[0-9]+$`.
-- "SUP-0001" is not a VEN code however it looks, and "V-TEST-STOCK" has no
-- serial at all — neither should push a counter forward.
--
-- MATCHED ON THE CODE, NOT THE PARTY TYPE. A counter hands out codes for a
-- prefix, so what must not repeat is a code already in use under that prefix,
-- whatever type the party carrying it happens to be. Reading the type instead
-- would miss a CUS- code sitting on a row filed as a vendor.
--
-- YEAR 0 IS A SENTINEL. `document_sequences` keys on (tenant, doc_type, year)
-- because every series it was built for restarts each January; a party code
-- does not, since VEN-00412 is the four-hundred-and-twelfth vendor this company
-- has ever recorded. 0 means "not year-scoped" and cannot collide with a real
-- year.
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

    FOREACH v_prefix IN ARRAY ARRAY['VEN', 'CUS', 'PRI'] LOOP
      -- One past the highest serial already in use for this prefix, or 1 when
      -- no party carries such a code.
      SELECT COALESCE(MAX((substring("code" from '[0-9]+$'))::int), 0) + 1
        INTO v_next
        FROM "parties"
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
