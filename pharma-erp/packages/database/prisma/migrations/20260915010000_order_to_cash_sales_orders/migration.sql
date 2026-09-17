-- =============================================================================
-- Order-to-Cash: sales orders
-- =============================================================================
-- The order a distributor places, priced and gated. Depends on
-- 20260915000000_order_to_cash_customer_register for the customer columns on
-- `parties`, and on the existing `items` register for what is being sold.
--
-- MONEY IS `numeric`, NEVER float. A rupee total has to reconcile against a
-- ledger, and IEEE-754 cannot hold 0.10 exactly. Quantities are numeric too:
-- strips and vials divide in ways an integer count cannot express.
--
-- THE GATE'S VERDICT IS STORED, NOT RECOMPUTED. licence_check / credit_check
-- and the figures beside them are a snapshot taken when the order was checked.
-- Recomputing on read would mean an order approved last Tuesday silently
-- re-decides itself today when the customer's balance moves — and the person
-- who approved it could no longer see what they approved. The snapshot is the
-- record; re-running the check overwrites it deliberately.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Vocabulary
-- -----------------------------------------------------------------------------

CREATE TYPE "SalesOrderStatus" AS ENUM (
  'DRAFT',
  'PENDING_CHECK',
  'APPROVED',
  'BLOCKED',
  'PARTIALLY_ALLOCATED',
  'ALLOCATED',
  'DISPATCHED',
  'COMPLETED',
  'CANCELLED'
);

CREATE TYPE "SalesOrderItemStatus" AS ENUM (
  'PENDING',
  'PARTIALLY_ALLOCATED',
  'ALLOCATED',
  'DISPATCHED',
  'CANCELLED'
);

-- NOT_RUN is distinct from FAIL on purpose: an unchecked order is not a
-- refused one, and showing "Fail" for "nobody has asked yet" would stop work
-- that was never blocked.
CREATE TYPE "CheckResult" AS ENUM ('NOT_RUN', 'PASS', 'FAIL');

-- -----------------------------------------------------------------------------
-- 2. Orders
-- -----------------------------------------------------------------------------

CREATE TABLE "sales_orders" (
  "id"        UUID NOT NULL,
  "tenant_id" UUID NOT NULL,

  -- Human-facing and quoted on every downstream document, so it is allocated
  -- from document_sequences rather than derived from the id.
  "order_number" VARCHAR(32) NOT NULL,

  "customer_id" UUID NOT NULL,

  "order_date"              DATE NOT NULL,
  "requested_delivery_date" DATE,

  "status" "SalesOrderStatus" NOT NULL DEFAULT 'DRAFT',

  -- Totals, denormalised from the lines. Held on the order because the list
  -- screen sorts and filters by them, and summing lines for every row would
  -- turn one query into N.
  "total_quantity" DECIMAL(14,3) NOT NULL DEFAULT 0,
  "subtotal"       DECIMAL(14,2) NOT NULL DEFAULT 0,
  "tax_amount"     DECIMAL(14,2) NOT NULL DEFAULT 0,
  "grand_total"    DECIMAL(14,2) NOT NULL DEFAULT 0,

  -- The gate's verdict and the figures behind it, as at `checked_at`.
  "licence_check"        "CheckResult" NOT NULL DEFAULT 'NOT_RUN',
  "credit_check"         "CheckResult" NOT NULL DEFAULT 'NOT_RUN',
  "check_failure_reason" VARCHAR(500),
  "checked_at"           TIMESTAMPTZ(6),

  "outstanding_amount" DECIMAL(14,2),
  "credit_limit"       DECIMAL(14,2),
  "available_credit"   DECIMAL(14,2),
  "order_amount"       DECIMAL(14,2),
  "credit_shortfall"   DECIMAL(14,2),

  "licence_number"      VARCHAR(64),
  "licence_expiry_date" DATE,

  "notes" VARCHAR(1000),

  "created_by_id" UUID,

  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  "deleted_at" TIMESTAMPTZ(6),

  CONSTRAINT "sales_orders_pkey" PRIMARY KEY ("id"),
  -- Delivery cannot be asked for before the order was placed.
  CONSTRAINT "sales_orders_delivery_after_order"
    CHECK ("requested_delivery_date" IS NULL OR "requested_delivery_date" >= "order_date")
);

CREATE UNIQUE INDEX "sales_orders_tenant_id_order_number_key"
  ON "sales_orders" ("tenant_id", "order_number");

CREATE INDEX "sales_orders_tenant_status_idx" ON "sales_orders" ("tenant_id", "status", "deleted_at");
CREATE INDEX "sales_orders_tenant_customer_idx" ON "sales_orders" ("tenant_id", "customer_id");
CREATE INDEX "sales_orders_tenant_order_date_idx" ON "sales_orders" ("tenant_id", "order_date");

-- -----------------------------------------------------------------------------
-- 3. Order lines
-- -----------------------------------------------------------------------------

CREATE TABLE "sales_order_items" (
  "id"             UUID NOT NULL,
  "tenant_id"      UUID NOT NULL,
  "sales_order_id" UUID NOT NULL,

  -- 1, 2, 3 within the order. Printed on the invoice, so it is stored rather
  -- than inferred from row order, which has none.
  "line_number" INTEGER NOT NULL,

  "item_id" UUID NOT NULL,

  "quantity_ordered"    DECIMAL(14,3) NOT NULL,
  -- Filled in by allocation and despatch. Kept here so a line knows its own
  -- progress without summing the allocation table on every read.
  "quantity_allocated"  DECIMAL(14,3) NOT NULL DEFAULT 0,
  "quantity_dispatched" DECIMAL(14,3) NOT NULL DEFAULT 0,

  -- Copied from the item at order time, NOT read through. A price list changes;
  -- an order placed at last month's price was placed at last month's price, and
  -- the invoice has to be able to prove it.
  "unit_price"       DECIMAL(14,2) NOT NULL,
  "discount_percent" DECIMAL(5,2)  NOT NULL DEFAULT 0,
  "discount_amount"  DECIMAL(14,2) NOT NULL DEFAULT 0,
  "gst_rate_percent" DECIMAL(5,2)  NOT NULL DEFAULT 0,
  "taxable_amount"   DECIMAL(14,2) NOT NULL DEFAULT 0,
  "tax_amount"       DECIMAL(14,2) NOT NULL DEFAULT 0,
  "line_total"       DECIMAL(14,2) NOT NULL DEFAULT 0,

  "status" "SalesOrderItemStatus" NOT NULL DEFAULT 'PENDING',

  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "sales_order_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sales_order_items_quantity_positive" CHECK ("quantity_ordered" > 0),
  -- You cannot allocate more than was ordered, nor despatch more than was
  -- allocated. Stated here because an application bug that broke either would
  -- otherwise ship stock nobody ordered.
  CONSTRAINT "sales_order_items_allocation_within_order"
    CHECK ("quantity_allocated" <= "quantity_ordered"),
  CONSTRAINT "sales_order_items_dispatch_within_allocation"
    CHECK ("quantity_dispatched" <= "quantity_allocated"),
  CONSTRAINT "sales_order_items_discount_is_a_percentage"
    CHECK ("discount_percent" >= 0 AND "discount_percent" <= 100)
);

CREATE UNIQUE INDEX "sales_order_items_order_line_key"
  ON "sales_order_items" ("sales_order_id", "line_number");

CREATE INDEX "sales_order_items_tenant_item_idx" ON "sales_order_items" ("tenant_id", "item_id");
CREATE INDEX "sales_order_items_order_idx" ON "sales_order_items" ("sales_order_id");

-- -----------------------------------------------------------------------------
-- 4. Foreign keys
-- -----------------------------------------------------------------------------

ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RESTRICT: a customer with orders on file cannot be removed from under them.
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_customer_id_fkey"
  FOREIGN KEY ("customer_id") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "sales_order_items" ADD CONSTRAINT "sales_order_items_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CASCADE here alone: a draft order's lines are part of the order, and editing
-- one means replacing them. The order itself is soft deleted, never dropped.
ALTER TABLE "sales_order_items" ADD CONSTRAINT "sales_order_items_sales_order_id_fkey"
  FOREIGN KEY ("sales_order_id") REFERENCES "sales_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "sales_order_items" ADD CONSTRAINT "sales_order_items_item_id_fkey"
  FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- 5. Tenant isolation
-- -----------------------------------------------------------------------------

ALTER TABLE "sales_orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sales_orders" FORCE ROW LEVEL SECURITY;
ALTER TABLE "sales_order_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sales_order_items" FORCE ROW LEVEL SECURITY;

DO $rls$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['sales_orders', 'sales_order_items'] LOOP
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
-- 6. No hard deletes on the order
-- -----------------------------------------------------------------------------
-- An order is a commercial commitment and is referenced by allocations and
-- invoices. Cancelling sets a status; it does not remove the record. Lines are
-- NOT protected — they cascade from the order, and blocking DELETE there would
-- make a draft uneditable.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'sales_orders'::regclass
      AND tgname = 'sales_orders_no_hard_delete'
  ) THEN
    CREATE TRIGGER "sales_orders_no_hard_delete"
      BEFORE DELETE ON "sales_orders"
      FOR EACH ROW EXECUTE FUNCTION public.prevent_hard_delete();
  END IF;
END
$$;

-- -----------------------------------------------------------------------------
-- 7. Privileges for the runtime role
-- -----------------------------------------------------------------------------

DO $grants$
DECLARE
  v_role text := 'pharma_app';
  v_table text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
    RAISE NOTICE 'Role % not present; skipping runtime grants.', v_role;
    RETURN;
  END IF;

  FOREACH v_table IN ARRAY ARRAY['sales_orders', 'sales_order_items'] LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE %I TO %I', v_table, v_role);
  END LOOP;

  -- Lines only: replacing a draft's lines is an ordinary edit.
  EXECUTE format('GRANT DELETE ON TABLE "sales_order_items" TO %I', v_role);
END
$grants$;

-- -----------------------------------------------------------------------------
-- 8. Assert nothing was missed
-- -----------------------------------------------------------------------------

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
