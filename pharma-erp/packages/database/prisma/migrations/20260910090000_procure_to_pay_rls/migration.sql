-- =============================================================================
-- Row-Level Security and write-guards for the Procure-to-Pay tables
-- =============================================================================
-- Companion to 20260910085827_procure_to_pay, which created the tables. Split
-- for the same reason the original RLS migration was: Prisma's schema language
-- cannot express policies, and keeping the security posture in a self-contained
-- file makes it reviewable on its own.
--
-- Every table added by that migration is tenant-scoped and gets the same
-- treatment the existing tables have:
--
--   ENABLE + FORCE ROW LEVEL SECURITY   -- owner does not bypass it either
--   a FOR ALL policy comparing tenant_id against current_tenant_id()
--   WITH CHECK using require_tenant_id() -- writing without a tenant raises
--   explicit grants to pharma_app        -- nothing is implicitly reachable
--
-- Fail-closed by construction: with no tenant set on the transaction,
-- current_tenant_id() is NULL, every comparison is NULL, and the row is
-- neither visible nor writable. Missing a table here would leave it readable
-- across tenants, so the DO block at the end asserts that none was missed
-- rather than trusting this file to be complete.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Tenant isolation
-- -----------------------------------------------------------------------------
-- Applied in a loop rather than 14 copy-pasted blocks. The policy text is
-- identical for every one of these tables, and a loop cannot contain the
-- transcription error that a fifteenth hand-written copy eventually would.

DO $rls$
DECLARE
  v_table text;
  v_tables text[] := ARRAY[
    'items',
    'parties',
    'document_sequences',
    'purchase_requisitions',
    'purchase_orders',
    'purchase_order_lines',
    'goods_receipts',
    'goods_receipt_lines',
    'stock_lots',
    'qc_results',
    'stock_ledger_entries',
    'purchase_invoices',
    'purchase_invoice_lines',
    'vendor_payments'
  ];
BEGIN
  FOREACH v_table IN ARRAY v_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', v_table);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', v_table);

    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL '
      'USING ("tenant_id" = public.current_tenant_id()) '
      'WITH CHECK ("tenant_id" = public.require_tenant_id())',
      v_table || '_tenant_isolation',
      v_table
    );
  END LOOP;
END
$rls$;

-- -----------------------------------------------------------------------------
-- 2. The stock ledger is append-only
-- -----------------------------------------------------------------------------
-- Same rule as audit_logs, and for the same reason: a ledger whose rows can be
-- edited after the fact is not evidence of anything. Corrections are posted as
-- a new entry with the opposite sign.
--
-- The tenant-isolation policy above is FOR ALL, which would permit UPDATE and
-- DELETE as far as RLS is concerned. Three things stop that: this trigger, the
-- privilege revoke below, and the API never exposing either verb.

CREATE TRIGGER "stock_ledger_entries_append_only"
  BEFORE UPDATE OR DELETE ON "stock_ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION public.enforce_append_only();

-- QC results are a record of a decision that was made. Amending one after the
-- fact would rewrite the quality history of a batch; a changed mind is a new
-- decision row, which is why the lot's status is maintained separately.
CREATE TRIGGER "qc_results_append_only"
  BEFORE UPDATE OR DELETE ON "qc_results"
  FOR EACH ROW EXECUTE FUNCTION public.enforce_append_only();

-- -----------------------------------------------------------------------------
-- 3. No hard deletes on the compliance-relevant documents
-- -----------------------------------------------------------------------------
-- These carry `deleted_at`; the trigger makes the soft delete the only route,
-- exactly as it does for tenants and users. Line tables are deliberately absent:
-- they cascade from their parent document and have no independent existence, so
-- blocking DELETE on them would block editing a draft order's lines.
--
-- stock_lots has no deleted_at and no trigger either: a received batch is never
-- removed, it changes status. REJECTED material stays in the table forever,
-- which is the whole point of rule 8 -- it must remain traceable.

CREATE TRIGGER "purchase_requisitions_no_hard_delete"
  BEFORE DELETE ON "purchase_requisitions"
  FOR EACH ROW EXECUTE FUNCTION public.prevent_hard_delete();

CREATE TRIGGER "purchase_orders_no_hard_delete"
  BEFORE DELETE ON "purchase_orders"
  FOR EACH ROW EXECUTE FUNCTION public.prevent_hard_delete();

CREATE TRIGGER "goods_receipts_no_hard_delete"
  BEFORE DELETE ON "goods_receipts"
  FOR EACH ROW EXECUTE FUNCTION public.prevent_hard_delete();

CREATE TRIGGER "purchase_invoices_no_hard_delete"
  BEFORE DELETE ON "purchase_invoices"
  FOR EACH ROW EXECUTE FUNCTION public.prevent_hard_delete();

CREATE TRIGGER "vendor_payments_no_hard_delete"
  BEFORE DELETE ON "vendor_payments"
  FOR EACH ROW EXECUTE FUNCTION public.prevent_hard_delete();

CREATE TRIGGER "items_no_hard_delete"
  BEFORE DELETE ON "items"
  FOR EACH ROW EXECUTE FUNCTION public.prevent_hard_delete();

CREATE TRIGGER "parties_no_hard_delete"
  BEFORE DELETE ON "parties"
  FOR EACH ROW EXECUTE FUNCTION public.prevent_hard_delete();

-- -----------------------------------------------------------------------------
-- 4. Privileges for the runtime role
-- -----------------------------------------------------------------------------
-- Explicit and idempotent, so this migration is correct on a managed Postgres
-- where docker/postgres/init/01-roles.sh never ran. A no-op when the role is
-- absent, as on a single-role CI database.

DO $grants$
DECLARE
  v_role text := 'pharma_app';
  v_table text;
  v_rw text[] := ARRAY[
    'items',
    'parties',
    'document_sequences',
    'purchase_requisitions',
    'purchase_orders',
    'purchase_order_lines',
    'goods_receipts',
    'goods_receipt_lines',
    'stock_lots',
    'purchase_invoices',
    'purchase_invoice_lines',
    'vendor_payments'
  ];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
    RAISE NOTICE 'Role % not present; skipping runtime grants.', v_role;
    RETURN;
  END IF;

  FOREACH v_table IN ARRAY v_rw LOOP
    -- No DELETE anywhere except the two line tables, which need it so a draft
    -- document's lines can be replaced. Everything else soft-deletes.
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE %I TO %I', v_table, v_role);
  END LOOP;

  EXECUTE format('GRANT DELETE ON TABLE "purchase_order_lines" TO %I', v_role);
  EXECUTE format('GRANT DELETE ON TABLE "purchase_invoice_lines" TO %I', v_role);
  EXECUTE format('GRANT DELETE ON TABLE "goods_receipt_lines" TO %I', v_role);

  -- Append-only pair: insert and read, never update or delete. Withholding the
  -- privilege means the guarantee does not rest on the trigger alone.
  EXECUTE format('GRANT SELECT, INSERT ON TABLE "qc_results" TO %I', v_role);
  EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "qc_results" FROM %I', v_role);

  EXECUTE format('GRANT SELECT, INSERT ON TABLE "stock_ledger_entries" TO %I', v_role);
  EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "stock_ledger_entries" FROM %I', v_role);
  EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE "stock_ledger_entries_id_seq" TO %I', v_role);
END
$grants$;

-- -----------------------------------------------------------------------------
-- 5. Assert nothing was missed
-- -----------------------------------------------------------------------------
-- A tenant-scoped table without RLS is a cross-tenant data leak that no test
-- of the application would notice, because the application filters by tenant
-- too. This check fails the migration instead: any table carrying a tenant_id
-- column must have RLS enabled AND forced.

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
