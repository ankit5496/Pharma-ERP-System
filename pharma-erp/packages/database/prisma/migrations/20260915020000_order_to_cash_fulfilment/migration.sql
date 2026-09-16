-- =============================================================================
-- Order-to-Cash: allocation, despatch, invoicing, receipts and returns
-- =============================================================================
-- The rest of the flow, from reserving stock to taking the money back off the
-- ledger when it is returned. Depends on 20260915010000 for sales_orders and on
-- 20260910152117 for batches / finished_goods_lots.
--
-- MONEY AND QUANTITY ARE `numeric` THROUGHOUT. Never float: these figures are
-- reconciled against a ledger and IEEE-754 cannot hold 0.10 exactly.
--
-- SNAPSHOTS, NOT LOOKUPS. Allocation copies the batch's expiry, invoicing
-- copies the batch number, the MRP, the addresses and both GSTINs. A tax
-- invoice is a statutory document: it has to keep saying what it said when it
-- was issued, even after the customer moves premises or the item master is
-- corrected. Reading those through a join would silently rewrite history.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Vocabulary
-- -----------------------------------------------------------------------------

CREATE TYPE "AllocationStatus" AS ENUM (
  'ALLOCATED',
  'PARTIALLY_DISPATCHED',
  'DISPATCHED',
  'RELEASED_BACK',
  'CANCELLED'
);

CREATE TYPE "DispatchStatus" AS ENUM ('DRAFT', 'DISPATCHED', 'DELIVERED', 'CANCELLED');

CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'CANCELLED');

CREATE TYPE "PaymentStatus" AS ENUM ('UNPAID', 'PARTIALLY_PAID', 'PAID');

CREATE TYPE "PaymentMethod" AS ENUM ('BANK_TRANSFER', 'UPI', 'CHEQUE', 'CASH', 'OTHER');

-- BOUNCED is not CANCELLED: a bounced cheque was received, recorded, and then
-- failed. The ledger has to show both the credit and its reversal.
CREATE TYPE "ReceiptStatus" AS ENUM ('RECORDED', 'CLEARED', 'BOUNCED', 'CANCELLED');

CREATE TYPE "SalesReturnStatus" AS ENUM ('DRAFT', 'RECEIVED', 'QUARANTINED', 'CREDITED', 'CANCELLED');

CREATE TYPE "ReturnReason" AS ENUM (
  'EXPIRED',
  'NEAR_EXPIRY',
  'DAMAGED',
  'BREAKAGE',
  'WRONG_ITEM',
  'QUALITY_COMPLAINT',
  'RECALL',
  'ORDER_ERROR',
  'OTHER'
);

-- Returned stock does NOT default to going back on the shelf. Medicine that has
-- been out of the company's custody has an unknown storage history, so the
-- default is QUARANTINE and putting it back is a decision somebody makes.
CREATE TYPE "ReturnedStockDisposition" AS ENUM ('QUARANTINE', 'DESTROY', 'RESTOCK');

CREATE TYPE "ReceivableEntryType" AS ENUM ('INVOICE', 'RECEIPT', 'CREDIT_NOTE', 'ADJUSTMENT');
CREATE TYPE "ReceivableDirection" AS ENUM ('DEBIT', 'CREDIT');

-- -----------------------------------------------------------------------------
-- 2. Allocation — reserving a batch against an order line
-- -----------------------------------------------------------------------------

CREATE TABLE "batch_allocations" (
  "id"        UUID NOT NULL,
  "tenant_id" UUID NOT NULL,

  "sales_order_id"      UUID NOT NULL,
  "sales_order_item_id" UUID NOT NULL,
  "batch_id"            UUID NOT NULL,

  "quantity_allocated"  DECIMAL(14,3) NOT NULL,
  "quantity_dispatched" DECIMAL(14,3) NOT NULL DEFAULT 0,

  -- The expiry AS AT ALLOCATION. Copied so a FEFO decision can be explained
  -- later with the figure it was actually made on.
  "expiry_date_at_allocation" DATE NOT NULL,

  "status" "AllocationStatus" NOT NULL DEFAULT 'ALLOCATED',

  -- Schedule H1 / H1X / X need a second compliance look before the stock
  -- physically moves, not only at order entry. The flag is set when the
  -- allocation is made and cleared only by someone recording the check.
  "compliance_recheck_required" BOOLEAN NOT NULL DEFAULT FALSE,
  "compliance_checked_at"       TIMESTAMPTZ(6),
  "compliance_checked_by_id"    UUID,
  "compliance_notes"            VARCHAR(1000),

  "allocated_by_id" UUID,

  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "batch_allocations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "batch_allocations_quantity_positive" CHECK ("quantity_allocated" > 0),
  CONSTRAINT "batch_allocations_dispatch_within_allocation"
    CHECK ("quantity_dispatched" <= "quantity_allocated")
);

CREATE INDEX "batch_allocations_tenant_order_idx" ON "batch_allocations" ("tenant_id", "sales_order_id");
CREATE INDEX "batch_allocations_tenant_batch_idx" ON "batch_allocations" ("tenant_id", "batch_id");
CREATE INDEX "batch_allocations_tenant_status_idx" ON "batch_allocations" ("tenant_id", "status");
CREATE INDEX "batch_allocations_order_item_idx" ON "batch_allocations" ("sales_order_item_id");

-- -----------------------------------------------------------------------------
-- 3. Despatch
-- -----------------------------------------------------------------------------

CREATE TABLE "dispatches" (
  "id"        UUID NOT NULL,
  "tenant_id" UUID NOT NULL,

  "dispatch_number" VARCHAR(32) NOT NULL,

  "sales_order_id"    UUID NOT NULL,
  "customer_id"       UUID NOT NULL,
  -- Set when the invoice is raised. Nullable because goods may leave before
  -- the paperwork is finished, which is ordinary in this trade.
  "sales_invoice_id"  UUID,

  "dispatch_date" DATE NOT NULL,
  "status" "DispatchStatus" NOT NULL DEFAULT 'DRAFT',

  "transporter_name" VARCHAR(255),
  "vehicle_number"   VARCHAR(32),
  -- Lorry receipt number from the transporter.
  "lr_number"        VARCHAR(64),
  "eway_bill_number" VARCHAR(32),

  "total_quantity" DECIMAL(14,3) NOT NULL DEFAULT 0,

  "notes" VARCHAR(1000),

  "created_by_id" UUID,

  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  "deleted_at" TIMESTAMPTZ(6),

  CONSTRAINT "dispatches_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "dispatches_tenant_id_dispatch_number_key"
  ON "dispatches" ("tenant_id", "dispatch_number");
CREATE INDEX "dispatches_tenant_order_idx" ON "dispatches" ("tenant_id", "sales_order_id");
CREATE INDEX "dispatches_tenant_customer_idx" ON "dispatches" ("tenant_id", "customer_id");
CREATE INDEX "dispatches_tenant_status_idx" ON "dispatches" ("tenant_id", "status", "deleted_at");

CREATE TABLE "dispatch_items" (
  "id"          UUID NOT NULL,
  "tenant_id"   UUID NOT NULL,
  "dispatch_id" UUID NOT NULL,

  "batch_allocation_id" UUID NOT NULL,

  "quantity_dispatched" DECIMAL(14,3) NOT NULL,

  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "dispatch_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "dispatch_items_quantity_positive" CHECK ("quantity_dispatched" > 0)
);

CREATE INDEX "dispatch_items_dispatch_idx" ON "dispatch_items" ("dispatch_id");
CREATE INDEX "dispatch_items_allocation_idx" ON "dispatch_items" ("batch_allocation_id");
CREATE INDEX "dispatch_items_tenant_idx" ON "dispatch_items" ("tenant_id");

-- -----------------------------------------------------------------------------
-- 4. Tax invoices
-- -----------------------------------------------------------------------------
-- Everything printed on the invoice is COPIED here at issue. A tax invoice is a
-- statutory document and must keep saying what it said, whatever later happens
-- to the customer record or the item master.

CREATE TABLE "sales_invoices" (
  "id"        UUID NOT NULL,
  "tenant_id" UUID NOT NULL,

  "invoice_number" VARCHAR(32) NOT NULL,

  "customer_id"    UUID NOT NULL,
  "sales_order_id" UUID,
  "dispatch_id"    UUID,

  "invoice_date" DATE NOT NULL,
  "due_date"     DATE,

  "status"         "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
  "payment_status" "PaymentStatus" NOT NULL DEFAULT 'UNPAID',

  -- Parties, as printed.
  "billing_name"     VARCHAR(255) NOT NULL,
  "billing_address"  VARCHAR(1000),
  "shipping_name"    VARCHAR(255),
  "shipping_address" VARCHAR(1000),
  "customer_gstin"   VARCHAR(15),
  "seller_gstin"     VARCHAR(15),

  -- Place of supply decides the tax split and is therefore part of the record,
  -- not something to re-derive from the customer's current address.
  "place_of_supply_state_code" VARCHAR(2),
  "seller_state_code"          VARCHAR(2),
  "is_inter_state"             BOOLEAN NOT NULL DEFAULT FALSE,

  "subtotal"        DECIMAL(14,2) NOT NULL DEFAULT 0,
  "discount_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  -- Intra-state splits into CGST + SGST; inter-state is IGST. Exactly one side
  -- is non-zero, which the CHECK below states.
  "cgst_amount"     DECIMAL(14,2) NOT NULL DEFAULT 0,
  "sgst_amount"     DECIMAL(14,2) NOT NULL DEFAULT 0,
  "igst_amount"     DECIMAL(14,2) NOT NULL DEFAULT 0,
  "tax_amount"      DECIMAL(14,2) NOT NULL DEFAULT 0,
  "grand_total"     DECIMAL(14,2) NOT NULL DEFAULT 0,

  "amount_paid"     DECIMAL(14,2) NOT NULL DEFAULT 0,
  "amount_credited" DECIMAL(14,2) NOT NULL DEFAULT 0,

  "notes" VARCHAR(1000),

  "created_by_id" UUID,

  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  "deleted_at" TIMESTAMPTZ(6),

  CONSTRAINT "sales_invoices_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sales_invoices_due_after_invoice"
    CHECK ("due_date" IS NULL OR "due_date" >= "invoice_date"),
  -- An invoice is either inter-state or it is not; it cannot carry both kinds
  -- of tax. Getting this wrong misfiles the return, so the database refuses it.
  CONSTRAINT "sales_invoices_one_tax_regime"
    CHECK (
      ("is_inter_state" AND "cgst_amount" = 0 AND "sgst_amount" = 0)
      OR (NOT "is_inter_state" AND "igst_amount" = 0)
    )
);

CREATE UNIQUE INDEX "sales_invoices_tenant_id_invoice_number_key"
  ON "sales_invoices" ("tenant_id", "invoice_number");
CREATE INDEX "sales_invoices_tenant_customer_idx" ON "sales_invoices" ("tenant_id", "customer_id");
CREATE INDEX "sales_invoices_tenant_payment_status_idx"
  ON "sales_invoices" ("tenant_id", "payment_status", "deleted_at");
CREATE INDEX "sales_invoices_tenant_due_date_idx" ON "sales_invoices" ("tenant_id", "due_date");

CREATE TABLE "sales_invoice_items" (
  "id"               UUID NOT NULL,
  "tenant_id"        UUID NOT NULL,
  "sales_invoice_id" UUID NOT NULL,

  "line_number" INTEGER NOT NULL,

  "item_id"  UUID NOT NULL,
  "batch_id" UUID NOT NULL,

  -- Copied at issue: the description, batch number, expiry and MRP as printed.
  "description"  VARCHAR(500) NOT NULL,
  "hsn_code"     VARCHAR(16),
  "batch_number" VARCHAR(32) NOT NULL,
  "expiry_date"  DATE NOT NULL,
  "mrp"          DECIMAL(14,2),

  "quantity"         DECIMAL(14,3) NOT NULL,
  "unit_price"       DECIMAL(14,2) NOT NULL,
  "discount_amount"  DECIMAL(14,2) NOT NULL DEFAULT 0,
  "taxable_value"    DECIMAL(14,2) NOT NULL DEFAULT 0,
  "gst_rate_percent" DECIMAL(5,2)  NOT NULL DEFAULT 0,
  "cgst_amount"      DECIMAL(14,2) NOT NULL DEFAULT 0,
  "sgst_amount"      DECIMAL(14,2) NOT NULL DEFAULT 0,
  "igst_amount"      DECIMAL(14,2) NOT NULL DEFAULT 0,
  "tax_amount"       DECIMAL(14,2) NOT NULL DEFAULT 0,
  "line_total"       DECIMAL(14,2) NOT NULL DEFAULT 0,

  -- The DPCO/NLEM ceiling as it stood at invoice time, when one applied. Kept
  -- so a later price-control audit can see what the limit was on the day.
  "ceiling_price_at_invoice" DECIMAL(14,2),

  "quantity_returned" DECIMAL(14,3) NOT NULL DEFAULT 0,

  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "sales_invoice_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sales_invoice_items_quantity_positive" CHECK ("quantity" > 0),
  -- More cannot come back than went out.
  CONSTRAINT "sales_invoice_items_return_within_quantity"
    CHECK ("quantity_returned" <= "quantity")
);

CREATE UNIQUE INDEX "sales_invoice_items_invoice_line_key"
  ON "sales_invoice_items" ("sales_invoice_id", "line_number");
CREATE INDEX "sales_invoice_items_tenant_item_idx" ON "sales_invoice_items" ("tenant_id", "item_id");
CREATE INDEX "sales_invoice_items_invoice_idx" ON "sales_invoice_items" ("sales_invoice_id");

-- -----------------------------------------------------------------------------
-- 5. Receipts
-- -----------------------------------------------------------------------------

CREATE TABLE "receipts" (
  "id"        UUID NOT NULL,
  "tenant_id" UUID NOT NULL,

  "receipt_number" VARCHAR(32) NOT NULL,

  "customer_id"      UUID NOT NULL,
  "sales_invoice_id" UUID NOT NULL,

  "receipt_date" DATE NOT NULL,
  "amount"       DECIMAL(14,2) NOT NULL,

  "payment_method"   "PaymentMethod" NOT NULL,
  "reference_number" VARCHAR(64),

  "status" "ReceiptStatus" NOT NULL DEFAULT 'RECORDED',

  "notes" VARCHAR(1000),

  "created_by_id" UUID,

  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "receipts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "receipts_amount_positive" CHECK ("amount" > 0)
);

CREATE UNIQUE INDEX "receipts_tenant_id_receipt_number_key" ON "receipts" ("tenant_id", "receipt_number");
CREATE INDEX "receipts_tenant_invoice_idx" ON "receipts" ("tenant_id", "sales_invoice_id");
CREATE INDEX "receipts_tenant_customer_idx" ON "receipts" ("tenant_id", "customer_id");

-- -----------------------------------------------------------------------------
-- 6. Sales returns
-- -----------------------------------------------------------------------------

CREATE TABLE "sales_returns" (
  "id"        UUID NOT NULL,
  "tenant_id" UUID NOT NULL,

  "return_number" VARCHAR(32) NOT NULL,

  "customer_id"      UUID NOT NULL,
  "sales_invoice_id" UUID NOT NULL,
  "sales_order_id"   UUID,

  "return_date" DATE NOT NULL,
  "reason"      "ReturnReason" NOT NULL,
  "reason_notes" VARCHAR(1000),

  "status" "SalesReturnStatus" NOT NULL DEFAULT 'DRAFT',

  "subtotal"     DECIMAL(14,2) NOT NULL DEFAULT 0,
  "tax_amount"   DECIMAL(14,2) NOT NULL DEFAULT 0,
  "total_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,

  "notes" VARCHAR(1000),

  "created_by_id" UUID,

  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  "deleted_at" TIMESTAMPTZ(6),

  CONSTRAINT "sales_returns_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sales_returns_tenant_id_return_number_key"
  ON "sales_returns" ("tenant_id", "return_number");
CREATE INDEX "sales_returns_tenant_invoice_idx" ON "sales_returns" ("tenant_id", "sales_invoice_id");
CREATE INDEX "sales_returns_tenant_customer_idx" ON "sales_returns" ("tenant_id", "customer_id");
CREATE INDEX "sales_returns_tenant_status_idx" ON "sales_returns" ("tenant_id", "status", "deleted_at");

CREATE TABLE "sales_return_items" (
  "id"              UUID NOT NULL,
  "tenant_id"       UUID NOT NULL,
  "sales_return_id" UUID NOT NULL,

  "sales_invoice_item_id" UUID NOT NULL,
  "item_id"               UUID NOT NULL,
  "batch_id"              UUID NOT NULL,

  "quantity"         DECIMAL(14,3) NOT NULL,
  "unit_price"       DECIMAL(14,2) NOT NULL,
  "gst_rate_percent" DECIMAL(5,2)  NOT NULL DEFAULT 0,
  "taxable_value"    DECIMAL(14,2) NOT NULL DEFAULT 0,
  "tax_amount"       DECIMAL(14,2) NOT NULL DEFAULT 0,
  "amount"           DECIMAL(14,2) NOT NULL DEFAULT 0,

  "reason" "ReturnReason" NOT NULL,
  -- QUARANTINE by default; putting medicine back on the shelf is a decision.
  "disposition" "ReturnedStockDisposition" NOT NULL DEFAULT 'QUARANTINE',

  "notes" VARCHAR(1000),

  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "sales_return_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sales_return_items_quantity_positive" CHECK ("quantity" > 0)
);

CREATE INDEX "sales_return_items_return_idx" ON "sales_return_items" ("sales_return_id");
CREATE INDEX "sales_return_items_invoice_item_idx" ON "sales_return_items" ("sales_invoice_item_id");
CREATE INDEX "sales_return_items_tenant_idx" ON "sales_return_items" ("tenant_id");

-- -----------------------------------------------------------------------------
-- 7. The receivable ledger
-- -----------------------------------------------------------------------------
-- Append-only. An invoice debits the customer, a receipt credits them, a credit
-- note credits them. The outstanding balance is the running sum, so it can be
-- explained line by line rather than asserted by a cached column.

CREATE TABLE "receivable_ledger_entries" (
  "id"        BIGSERIAL NOT NULL,
  "tenant_id" UUID NOT NULL,

  "customer_id" UUID NOT NULL,

  "entry_type" "ReceivableEntryType" NOT NULL,
  "direction"  "ReceivableDirection" NOT NULL,
  "amount"     DECIMAL(14,2) NOT NULL,

  -- Whichever document caused the entry. Exactly one is expected to be set,
  -- but it is not constrained: an ADJUSTMENT legitimately names none.
  "sales_invoice_id" UUID,
  "receipt_id"       UUID,
  "sales_return_id"  UUID,

  "notes" VARCHAR(1000),

  "created_by_id" UUID,

  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "receivable_ledger_entries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "receivable_ledger_entries_amount_positive" CHECK ("amount" > 0)
);

CREATE INDEX "receivable_ledger_entries_tenant_customer_idx"
  ON "receivable_ledger_entries" ("tenant_id", "customer_id", "created_at");
CREATE INDEX "receivable_ledger_entries_tenant_invoice_idx"
  ON "receivable_ledger_entries" ("tenant_id", "sales_invoice_id");

-- -----------------------------------------------------------------------------
-- 8. Foreign keys
-- -----------------------------------------------------------------------------

ALTER TABLE "batch_allocations"
  ADD CONSTRAINT "batch_allocations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "batch_allocations_sales_order_id_fkey" FOREIGN KEY ("sales_order_id") REFERENCES "sales_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "batch_allocations_sales_order_item_id_fkey" FOREIGN KEY ("sales_order_item_id") REFERENCES "sales_order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "batch_allocations_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "batch_allocations_compliance_checked_by_id_fkey" FOREIGN KEY ("compliance_checked_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "batch_allocations_allocated_by_id_fkey" FOREIGN KEY ("allocated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "dispatches"
  ADD CONSTRAINT "dispatches_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "dispatches_sales_order_id_fkey" FOREIGN KEY ("sales_order_id") REFERENCES "sales_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "dispatches_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "dispatches_sales_invoice_id_fkey" FOREIGN KEY ("sales_invoice_id") REFERENCES "sales_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "dispatches_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "dispatch_items"
  ADD CONSTRAINT "dispatch_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "dispatch_items_dispatch_id_fkey" FOREIGN KEY ("dispatch_id") REFERENCES "dispatches"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "dispatch_items_batch_allocation_id_fkey" FOREIGN KEY ("batch_allocation_id") REFERENCES "batch_allocations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "sales_invoices"
  ADD CONSTRAINT "sales_invoices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "sales_invoices_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "sales_invoices_sales_order_id_fkey" FOREIGN KEY ("sales_order_id") REFERENCES "sales_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "sales_invoices_dispatch_id_fkey" FOREIGN KEY ("dispatch_id") REFERENCES "dispatches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "sales_invoices_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "sales_invoice_items"
  ADD CONSTRAINT "sales_invoice_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "sales_invoice_items_sales_invoice_id_fkey" FOREIGN KEY ("sales_invoice_id") REFERENCES "sales_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "sales_invoice_items_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "sales_invoice_items_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "receipts"
  ADD CONSTRAINT "receipts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "receipts_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "receipts_sales_invoice_id_fkey" FOREIGN KEY ("sales_invoice_id") REFERENCES "sales_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "receipts_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "sales_returns"
  ADD CONSTRAINT "sales_returns_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "sales_returns_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "sales_returns_sales_invoice_id_fkey" FOREIGN KEY ("sales_invoice_id") REFERENCES "sales_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "sales_returns_sales_order_id_fkey" FOREIGN KEY ("sales_order_id") REFERENCES "sales_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "sales_returns_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "sales_return_items"
  ADD CONSTRAINT "sales_return_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "sales_return_items_sales_return_id_fkey" FOREIGN KEY ("sales_return_id") REFERENCES "sales_returns"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "sales_return_items_sales_invoice_item_id_fkey" FOREIGN KEY ("sales_invoice_item_id") REFERENCES "sales_invoice_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "sales_return_items_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "sales_return_items_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "receivable_ledger_entries"
  ADD CONSTRAINT "receivable_ledger_entries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "receivable_ledger_entries_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "receivable_ledger_entries_sales_invoice_id_fkey" FOREIGN KEY ("sales_invoice_id") REFERENCES "sales_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "receivable_ledger_entries_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "receivable_ledger_entries_sales_return_id_fkey" FOREIGN KEY ("sales_return_id") REFERENCES "sales_returns"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "receivable_ledger_entries_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- 9. Tenant isolation
-- -----------------------------------------------------------------------------

DO $rls$
DECLARE
  v_table text;
  v_tables text[] := ARRAY[
    'batch_allocations',
    'dispatches',
    'dispatch_items',
    'sales_invoices',
    'sales_invoice_items',
    'receipts',
    'sales_returns',
    'sales_return_items',
    'receivable_ledger_entries'
  ];
BEGIN
  FOREACH v_table IN ARRAY v_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', v_table);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', v_table);

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
-- 10. No hard deletes on the documents that are evidence
-- -----------------------------------------------------------------------------
-- An issued invoice, a despatch and a return are records somebody may be asked
-- to produce. Cancelling sets a status. Line tables are not protected: they
-- cascade from their parent and a draft has to remain editable.

DO $triggers$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['sales_invoices', 'dispatches', 'sales_returns'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgrelid = v_table::regclass
        AND tgname = v_table || '_no_hard_delete'
    ) THEN
      EXECUTE format(
        'CREATE TRIGGER %I BEFORE DELETE ON %I FOR EACH ROW EXECUTE FUNCTION public.prevent_hard_delete()',
        v_table || '_no_hard_delete',
        v_table
      );
    END IF;
  END LOOP;
END
$triggers$;

-- -----------------------------------------------------------------------------
-- 11. Privileges for the runtime role
-- -----------------------------------------------------------------------------

DO $grants$
DECLARE
  v_role text := 'pharma_app';
  v_table text;
  v_rw text[] := ARRAY[
    'batch_allocations',
    'dispatches',
    'dispatch_items',
    'sales_invoices',
    'sales_invoice_items',
    'receipts',
    'sales_returns',
    'sales_return_items'
  ];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
    RAISE NOTICE 'Role % not present; skipping runtime grants.', v_role;
    RETURN;
  END IF;

  FOREACH v_table IN ARRAY v_rw LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE %I TO %I', v_table, v_role);
  END LOOP;

  -- Line tables need DELETE so a draft's lines can be replaced.
  EXECUTE format('GRANT DELETE ON TABLE "dispatch_items" TO %I', v_role);
  EXECUTE format('GRANT DELETE ON TABLE "sales_invoice_items" TO %I', v_role);
  EXECUTE format('GRANT DELETE ON TABLE "sales_return_items" TO %I', v_role);

  -- Append-only: the ledger is inserted and read, never rewritten. A balance
  -- that can be edited is not a ledger.
  EXECUTE format('GRANT SELECT, INSERT ON TABLE "receivable_ledger_entries" TO %I', v_role);
  EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "receivable_ledger_entries" FROM %I', v_role);
  EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE "receivable_ledger_entries_id_seq" TO %I', v_role);
END
$grants$;

-- -----------------------------------------------------------------------------
-- 12. Assert nothing was missed
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
