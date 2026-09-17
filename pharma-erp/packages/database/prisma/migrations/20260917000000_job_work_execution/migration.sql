-- =============================================================================
-- Job Work execution — US-JW-01 … US-JW-06
-- =============================================================================
-- The agreement register (20260913010000) said what was owed once production
-- could carry an agreement:
--
--   "What is owed when Production lands: production_orders gains agreement_id
--    and a COPY of billing_model, taken at creation the way bom_id already is,
--    plus a BEFORE UPDATE trigger refusing a change to that column once status
--    has left PLANNED."
--
-- This migration pays that debt and adds the three tables the job-work flow
-- needs beyond what already exists. It deliberately does NOT add tables for
-- production, quality or finished goods: US-JW-03 and US-JW-04 reuse
-- production_orders, material_issues and batches unchanged.
--
-- THE ONE STRUCTURAL CHANGE TO AN EXISTING TABLE is stock_lots. Principal-owned
-- material has to live in the same table as company-owned material, because
-- material_issue_lines.lot_id points there and FEFO allocates from there — a
-- parallel table would need both mechanisms rebuilt and could not be issued
-- from. So: goods_receipt_line_id becomes NULLABLE (a principal's challan
-- creates no goods receipt) and an `ownership` discriminator arrives with a
-- default that labels every pre-existing lot correctly without a backfill.
--
-- Guarded with IF NOT EXISTS throughout, matching every migration before it:
-- the hosted database and a fresh local one are in different states and one
-- file has to bring either to the same place.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Enums
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'StockOwnership') THEN
    CREATE TYPE "StockOwnership" AS ENUM ('COMPANY_OWNED', 'PRINCIPAL_OWNED');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'JobWorkInvoiceBasis') THEN
    CREATE TYPE "JobWorkInvoiceBasis" AS ENUM ('CONVERSION_CHARGE_ONLY', 'FULL_FINISHED_GOODS_VALUE');
  END IF;
END
$$;

-- -----------------------------------------------------------------------------
-- 2. Job-work orders (US-JW-01)
-- -----------------------------------------------------------------------------
-- mapping_id rather than a loose product_id + brand: a job_work_product_mappings
-- row IS a (BOM → product, principal brand) pair, so pointing at one satisfies
-- "Product + Brand must be valid according to the Agreement's Product-Brand
-- Mapping" structurally. A product outside the agreement has no mapping row to
-- reference, and a valid product carrying another principal's brand is not
-- expressible.
--
-- billing_model is a COPY, not a join. The order was placed on the terms in
-- force the day it was placed; renegotiating next month must not retroactively
-- change which stock bucket an in-flight batch may consume.

CREATE TABLE IF NOT EXISTS "job_work_orders" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_number" VARCHAR(32) NOT NULL,
    "principal_id" UUID NOT NULL,
    "agreement_id" UUID NOT NULL,
    "mapping_id" UUID NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "delivery_date" DATE NOT NULL,
    "billing_model" "BillingModel" NOT NULL,
    "notes" VARCHAR(1000),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "job_work_orders_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'job_work_orders_tenant_id_fkey') THEN
    ALTER TABLE "job_work_orders" ADD CONSTRAINT "job_work_orders_tenant_id_fkey"
      FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  -- RESTRICT throughout: a principal, agreement or mapping named by a live
  -- order must not vanish out from under it.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'job_work_orders_principal_id_fkey') THEN
    ALTER TABLE "job_work_orders" ADD CONSTRAINT "job_work_orders_principal_id_fkey"
      FOREIGN KEY ("principal_id") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'job_work_orders_agreement_id_fkey') THEN
    ALTER TABLE "job_work_orders" ADD CONSTRAINT "job_work_orders_agreement_id_fkey"
      FOREIGN KEY ("agreement_id") REFERENCES "job_work_agreements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'job_work_orders_mapping_id_fkey') THEN
    ALTER TABLE "job_work_orders" ADD CONSTRAINT "job_work_orders_mapping_id_fkey"
      FOREIGN KEY ("mapping_id") REFERENCES "job_work_product_mappings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'job_work_orders_created_by_id_fkey') THEN
    ALTER TABLE "job_work_orders" ADD CONSTRAINT "job_work_orders_created_by_id_fkey"
      FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS "job_work_orders_tenant_id_order_number_key"
  ON "job_work_orders"("tenant_id", "order_number");
CREATE INDEX IF NOT EXISTS "job_work_orders_tenant_id_principal_id_deleted_at_idx"
  ON "job_work_orders"("tenant_id", "principal_id", "deleted_at");
CREATE INDEX IF NOT EXISTS "job_work_orders_tenant_id_agreement_id_deleted_at_idx"
  ON "job_work_orders"("tenant_id", "agreement_id", "deleted_at");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'job_work_orders_quantity_positive') THEN
    ALTER TABLE "job_work_orders" ADD CONSTRAINT "job_work_orders_quantity_positive"
      CHECK ("quantity" > 0);
  END IF;
END
$$;

-- -----------------------------------------------------------------------------
-- 3. Job-work material receipts (US-JW-02)
-- -----------------------------------------------------------------------------
-- NOT A PURCHASE, and the table says so by what it lacks: no vendor, no order,
-- no rate, no tax, no invoice. "This transaction does NOT create a Purchase
-- transaction" is structural here rather than a rule someone has to remember —
-- there is no column a purchase could be recorded in.
--
-- delivery_challan_number is deliberately NOT unique: it is the principal's
-- numbering, not ours, and two principals may share a series.

CREATE TABLE IF NOT EXISTS "job_work_material_receipts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "receipt_number" VARCHAR(32) NOT NULL,
    "job_work_order_id" UUID NOT NULL,
    "delivery_challan_number" VARCHAR(64) NOT NULL,
    "item_id" UUID NOT NULL,
    "batch_number" VARCHAR(64) NOT NULL,
    "received_quantity" DECIMAL(18,4) NOT NULL,
    "manufacturing_date" DATE,
    "expiry_date" DATE,
    "notes" VARCHAR(500),
    "received_by_id" UUID,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "job_work_material_receipts_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'job_work_material_receipts_tenant_id_fkey') THEN
    ALTER TABLE "job_work_material_receipts" ADD CONSTRAINT "job_work_material_receipts_tenant_id_fkey"
      FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'job_work_material_receipts_job_work_order_id_fkey') THEN
    ALTER TABLE "job_work_material_receipts" ADD CONSTRAINT "job_work_material_receipts_job_work_order_id_fkey"
      FOREIGN KEY ("job_work_order_id") REFERENCES "job_work_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'job_work_material_receipts_item_id_fkey') THEN
    ALTER TABLE "job_work_material_receipts" ADD CONSTRAINT "job_work_material_receipts_item_id_fkey"
      FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'job_work_material_receipts_received_by_id_fkey') THEN
    ALTER TABLE "job_work_material_receipts" ADD CONSTRAINT "job_work_material_receipts_received_by_id_fkey"
      FOREIGN KEY ("received_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS "job_work_material_receipts_tenant_id_receipt_number_key"
  ON "job_work_material_receipts"("tenant_id", "receipt_number");
CREATE INDEX IF NOT EXISTS "job_work_material_receipts_tenant_order_deleted_idx"
  ON "job_work_material_receipts"("tenant_id", "job_work_order_id", "deleted_at");
CREATE INDEX IF NOT EXISTS "job_work_material_receipts_tenant_id_item_id_idx"
  ON "job_work_material_receipts"("tenant_id", "item_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'job_work_material_receipts_quantity_positive') THEN
    ALTER TABLE "job_work_material_receipts" ADD CONSTRAINT "job_work_material_receipts_quantity_positive"
      CHECK ("received_quantity" > 0);
  END IF;

  -- A blank challan number passes VARCHAR and is not a challan number. The
  -- whole point of US-JW-02 is that the principal's document is on file.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'job_work_material_receipts_challan_not_blank') THEN
    ALTER TABLE "job_work_material_receipts" ADD CONSTRAINT "job_work_material_receipts_challan_not_blank"
      CHECK (length(btrim("delivery_challan_number")) > 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'job_work_material_receipts_batch_not_blank') THEN
    ALTER TABLE "job_work_material_receipts" ADD CONSTRAINT "job_work_material_receipts_batch_not_blank"
      CHECK (length(btrim("batch_number")) > 0);
  END IF;
END
$$;

-- -----------------------------------------------------------------------------
-- 4. stock_lots gains an owner (US-JW-02, rules 6/7, controls 4/5/9)
-- -----------------------------------------------------------------------------

ALTER TABLE "stock_lots"
  ADD COLUMN IF NOT EXISTS "ownership" "StockOwnership" NOT NULL DEFAULT 'COMPANY_OWNED';

ALTER TABLE "stock_lots"
  ADD COLUMN IF NOT EXISTS "job_work_material_receipt_id" UUID;

-- A principal's material arrives on their challan, so there is no goods receipt
-- line to point at. Dropping NOT NULL is what lets the lot exist at all without
-- inventing a fake purchase to hold it.
ALTER TABLE "stock_lots" ALTER COLUMN "goods_receipt_line_id" DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_lots_job_work_material_receipt_id_fkey') THEN
    ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_job_work_material_receipt_id_fkey"
      FOREIGN KEY ("job_work_material_receipt_id") REFERENCES "job_work_material_receipts"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS "stock_lots_job_work_material_receipt_id_key"
  ON "stock_lots"("job_work_material_receipt_id");

CREATE INDEX IF NOT EXISTS "stock_lots_tenant_ownership_item_status_expiry_idx"
  ON "stock_lots"("tenant_id", "ownership", "item_id", "status", "expiry_date");

DO $$
BEGIN
  -- Exactly one source, and it must agree with the ownership tag. This is what
  -- makes "principal-owned stock is structurally separate" true of the data
  -- rather than only of the queries: a principal-owned lot with a goods receipt
  -- behind it, or a company-owned lot with a job-work receipt behind it, cannot
  -- be stored at all.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_lots_has_one_source') THEN
    ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_has_one_source"
      CHECK (
        ("ownership" = 'COMPANY_OWNED'
          AND "goods_receipt_line_id" IS NOT NULL
          AND "job_work_material_receipt_id" IS NULL)
        OR
        ("ownership" = 'PRINCIPAL_OWNED'
          AND "job_work_material_receipt_id" IS NOT NULL
          AND "goods_receipt_line_id" IS NULL)
      );
  END IF;
END
$$;

-- -----------------------------------------------------------------------------
-- 5. production_orders carries the job work (US-JW-03, US-MD-05 second half)
-- -----------------------------------------------------------------------------

ALTER TABLE "production_orders" ADD COLUMN IF NOT EXISTS "job_work_order_id" UUID;
ALTER TABLE "production_orders" ADD COLUMN IF NOT EXISTS "job_work_billing_model" "BillingModel";

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'production_orders_job_work_order_id_fkey') THEN
    ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_job_work_order_id_fkey"
      FOREIGN KEY ("job_work_order_id") REFERENCES "job_work_orders"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  -- Both or neither. A work order tagged to a principal with no billing model
  -- would have no stock bucket to derive, and a billing model with no order
  -- would be a number governing nothing.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'production_orders_job_work_fields_together') THEN
    ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_job_work_fields_together"
      CHECK (("job_work_order_id" IS NULL) = ("job_work_billing_model" IS NULL));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "production_orders_tenant_id_job_work_order_id_idx"
  ON "production_orders"("tenant_id", "job_work_order_id");

-- US-MD-05, second half: "cannot be changed on an order that is already in
-- production". A trigger rather than a service rule, because the criterion is
-- about what must be impossible, not about what the UI should discourage.
CREATE OR REPLACE FUNCTION public.freeze_job_work_terms()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF OLD."status" <> 'PLANNED' THEN
    IF NEW."job_work_billing_model" IS DISTINCT FROM OLD."job_work_billing_model"
       OR NEW."job_work_order_id" IS DISTINCT FROM OLD."job_work_order_id" THEN
      RAISE EXCEPTION
        'Work order % has left PLANNED (status %); its job-work order and billing model are fixed. '
        'Material has already been dispensed against the bucket those terms chose.',
        OLD."order_number", OLD."status"
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$fn$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'production_orders'::regclass AND tgname = 'production_orders_freeze_job_work_terms'
  ) THEN
    CREATE TRIGGER "production_orders_freeze_job_work_terms"
      BEFORE UPDATE ON "production_orders"
      FOR EACH ROW EXECUTE FUNCTION public.freeze_job_work_terms();
  END IF;
END
$$;

-- -----------------------------------------------------------------------------
-- 6. Job-work invoices (US-JW-05)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "job_work_invoices" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "invoice_number" VARCHAR(32) NOT NULL,
    "job_work_order_id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "invoice_basis" "JobWorkInvoiceBasis" NOT NULL,
    "billing_model" "BillingModel" NOT NULL,
    "dispatch_date" DATE NOT NULL,
    "dispatched_quantity" DECIMAL(14,3) NOT NULL,
    "rate_applied" DECIMAL(14,4) NOT NULL,
    "rate_basis" "ConversionRateBasis",
    "taxable_value" DECIMAL(14,2) NOT NULL,
    "gst_rate_percent" DECIMAL(5,2) NOT NULL,
    "gst_amount" DECIMAL(14,2) NOT NULL,
    "total_value" DECIMAL(14,2) NOT NULL,
    "notes" VARCHAR(1000),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "job_work_invoices_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'job_work_invoices_tenant_id_fkey') THEN
    ALTER TABLE "job_work_invoices" ADD CONSTRAINT "job_work_invoices_tenant_id_fkey"
      FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'job_work_invoices_job_work_order_id_fkey') THEN
    ALTER TABLE "job_work_invoices" ADD CONSTRAINT "job_work_invoices_job_work_order_id_fkey"
      FOREIGN KEY ("job_work_order_id") REFERENCES "job_work_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'job_work_invoices_batch_id_fkey') THEN
    ALTER TABLE "job_work_invoices" ADD CONSTRAINT "job_work_invoices_batch_id_fkey"
      FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'job_work_invoices_created_by_id_fkey') THEN
    ALTER TABLE "job_work_invoices" ADD CONSTRAINT "job_work_invoices_created_by_id_fkey"
      FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS "job_work_invoices_tenant_id_invoice_number_key"
  ON "job_work_invoices"("tenant_id", "invoice_number");
CREATE INDEX IF NOT EXISTS "job_work_invoices_tenant_order_deleted_idx"
  ON "job_work_invoices"("tenant_id", "job_work_order_id", "deleted_at");
CREATE INDEX IF NOT EXISTS "job_work_invoices_tenant_id_batch_id_idx"
  ON "job_work_invoices"("tenant_id", "batch_id");

DO $$
BEGIN
  -- CONTROL 7, in the database. "Do not allow PURE_CONVERSION + Full Value" and
  -- "do not allow OWN_PROCUREMENT + Conversion Charge" are not service rules
  -- that a direct UPDATE could sidestep: the contradictory pair is unstorable.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'job_work_invoices_basis_matches_model') THEN
    ALTER TABLE "job_work_invoices" ADD CONSTRAINT "job_work_invoices_basis_matches_model"
      CHECK (
        ("billing_model" = 'PURE_CONVERSION' AND "invoice_basis" = 'CONVERSION_CHARGE_ONLY')
        OR
        ("billing_model" = 'OWN_PROCUREMENT' AND "invoice_basis" = 'FULL_FINISHED_GOODS_VALUE')
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'job_work_invoices_quantity_positive') THEN
    ALTER TABLE "job_work_invoices" ADD CONSTRAINT "job_work_invoices_quantity_positive"
      CHECK ("dispatched_quantity" > 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'job_work_invoices_amounts_non_negative') THEN
    ALTER TABLE "job_work_invoices" ADD CONSTRAINT "job_work_invoices_amounts_non_negative"
      CHECK ("rate_applied" >= 0 AND "taxable_value" >= 0 AND "gst_amount" >= 0 AND "total_value" >= 0);
  END IF;
END
$$;

-- -----------------------------------------------------------------------------
-- 7. Row-Level Security
-- -----------------------------------------------------------------------------

ALTER TABLE "job_work_orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "job_work_orders" FORCE ROW LEVEL SECURITY;
ALTER TABLE "job_work_material_receipts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "job_work_material_receipts" FORCE ROW LEVEL SECURITY;
ALTER TABLE "job_work_invoices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "job_work_invoices" FORCE ROW LEVEL SECURITY;

DO $rls$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['job_work_orders', 'job_work_material_receipts', 'job_work_invoices'] LOOP
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
-- 8. No hard deletes
-- -----------------------------------------------------------------------------
-- All three carry deleted_at and all three are commercial record: what a
-- principal was asked to be sent, what they supplied, and what they were
-- billed.

DO $del$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['job_work_orders', 'job_work_material_receipts', 'job_work_invoices'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgrelid = v_table::regclass AND tgname = v_table || '_no_hard_delete'
    ) THEN
      EXECUTE format(
        'CREATE TRIGGER %I BEFORE DELETE ON %I FOR EACH ROW EXECUTE FUNCTION public.prevent_hard_delete()',
        v_table || '_no_hard_delete',
        v_table
      );
    END IF;
  END LOOP;
END
$del$;

-- -----------------------------------------------------------------------------
-- 9. Privileges for the runtime role
-- -----------------------------------------------------------------------------
-- A no-op when the role does not exist yet, which is the case on a managed
-- database where scripts/render-bootstrap.sql runs after the migrations.

DO $grants$
DECLARE
  v_role text := 'pharma_app';
  v_table text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
    RAISE NOTICE 'Role % not present; skipping runtime grants.', v_role;
    RETURN;
  END IF;

  FOREACH v_table IN ARRAY ARRAY['job_work_orders', 'job_work_material_receipts', 'job_work_invoices'] LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I TO %I', v_table, v_role);
  END LOOP;
END
$grants$;
