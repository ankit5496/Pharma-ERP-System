-- Reclassifies already-closed orders that were in fact received in full.
--
-- SEPARATE FROM THE MIGRATION THAT ADDED THE LABEL, and that is a PostgreSQL
-- rule rather than a stylistic choice: a new enum value may not be USED in the
-- transaction that added it (error 55P04, "unsafe use of new value"). Each
-- Prisma migration runs in its own transaction, so the label added by
-- 20260916000000 is committed by the time this file runs.
--
-- Orders closed while still short are deliberately LEFT ALONE, with their
-- cancelled quantity at zero. Recording a cancellation nobody actually decided
-- would be inventing history — and since receivability now follows the pending
-- quantity rather than the status, those orders simply become available for
-- goods receipt again, which is the behaviour that was asked for.
--
-- WHY THIS LOOPS TENANTS. These tables are FORCE ROW LEVEL SECURITY, which
-- binds the table owner too. A plain UPDATE here runs with no tenant set,
-- matches ZERO rows, and reports success — the failure mode that makes a
-- migration look applied when it did nothing.

DO $backfill$
DECLARE
  v_tenant  UUID;
  v_updated INT;
  v_total   INT := 0;
BEGIN
  FOR v_tenant IN SELECT id FROM tenants LOOP
    PERFORM set_config('app.current_tenant_id', v_tenant::text, true);

    UPDATE "purchase_orders" o
       SET "status" = 'FULLY_RECEIVED'
     WHERE o."status" = 'CLOSED'
       AND o."deleted_at" IS NULL
       AND NOT EXISTS (
         SELECT 1
           FROM "purchase_order_lines" l
          WHERE l."purchase_order_id" = o."id"
            AND l."quantity_received" < l."quantity"
       );

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    v_total := v_total + v_updated;
  END LOOP;

  RAISE NOTICE 'Reclassified % closed order(s) as fully received.', v_total;
END
$backfill$;
