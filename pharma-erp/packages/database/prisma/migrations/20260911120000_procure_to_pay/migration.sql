-- =============================================================================
-- Procure-to-Pay
-- =============================================================================
-- Buying raw materials: low stock -> requisition -> purchase order -> goods
-- receipt -> incoming QC -> usable inventory -> invoice -> payable -> payment.
--
-- LAYERED ON TOP OF THE SHARED MASTER-DATA SCHEMA, not alongside it. The item
-- master, bills of material and their components already exist from
-- 20260910152116 and 20260911000000; this migration adds only what does not:
-- the documents, the batch and stock-ledger tables, and the vendor register.
--
-- Three things it deliberately does NOT do, each because the shared schema
-- already answers the question:
--
--   * No tax-rate table. GST comes from items.gst_rate, next to items.hsn_code.
--   * No production-plan component list. A plan points at a BOM and reads
--     bom_lines, so a revised formulation cannot leave stale copies behind.
--   * No batch-tracking flag on items. It is derived from the item type.
--
-- Quantities and money are DECIMAL throughout, never Float: a binary float
-- cannot represent 0.1, and a dispensing quantity or invoice total wrong in the
-- fourth decimal place is a regulatory problem, not a rounding curiosity.
-- =============================================================================

-- CreateEnum
CREATE TYPE "PartyType" AS ENUM ('VENDOR', 'CUSTOMER', 'JOB_WORK_PRINCIPAL');

-- CreateEnum
CREATE TYPE "RequisitionStatus" AS ENUM ('OPEN', 'APPROVED', 'CONVERTED_TO_PO', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RequisitionTriggerType" AS ENUM ('AUTO_REORDER', 'MANUAL');

-- CreateEnum
CREATE TYPE "ProductionPlanStatus" AS ENUM ('DRAFT', 'PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('DRAFT', 'ISSUED', 'PARTIALLY_RECEIVED', 'FULLY_RECEIVED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "QcDecision" AS ENUM ('ACCEPTED', 'REJECTED', 'ON_HOLD');

-- CreateEnum
CREATE TYPE "StockLotStatus" AS ENUM ('QUARANTINE', 'USABLE', 'REJECTED', 'ON_HOLD', 'CONSUMED');

-- CreateEnum
CREATE TYPE "PurchaseInvoiceStatus" AS ENUM ('DRAFT', 'APPROVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "StockLedgerEntryType" AS ENUM ('GRN_QUARANTINE', 'QC_ACCEPTED', 'QC_REJECTED', 'QC_HOLD', 'QC_RELEASED_FROM_HOLD', 'ADJUSTMENT');

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "invoice_tolerance_percent" DECIMAL(5,2) NOT NULL DEFAULT 2.00;

-- CreateTable
CREATE TABLE "parties" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "party_type" "PartyType" NOT NULL DEFAULT 'VENDOR',
    "gstin" VARCHAR(15),
    "drug_licence_number" VARCHAR(64),
    "email" VARCHAR(320),
    "phone" VARCHAR(32),
    "address" VARCHAR(1000),
    "payment_terms_days" INTEGER NOT NULL DEFAULT 30,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "parties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_sequences" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "doc_type" VARCHAR(16) NOT NULL,
    "year" INTEGER NOT NULL,
    "next_value" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "document_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_requisitions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "number" VARCHAR(32) NOT NULL,
    "item_id" UUID NOT NULL,
    "stock_at_request" DECIMAL(18,4) NOT NULL,
    "reorder_level_at_request" DECIMAL(18,4) NOT NULL,
    "required_quantity" DECIMAL(18,4) NOT NULL,
    "preferred_vendor_id" UUID,
    "trigger_type" "RequisitionTriggerType" NOT NULL DEFAULT 'MANUAL',
    "production_plan_id" UUID,
    "requested_by_id" UUID,
    "approved_by_id" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "request_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "required_by_date" TIMESTAMPTZ(6),
    "status" "RequisitionStatus" NOT NULL DEFAULT 'OPEN',
    "notes" VARCHAR(1000),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "purchase_requisitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "number" VARCHAR(32) NOT NULL,
    "vendor_id" UUID NOT NULL,
    "po_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expected_delivery_date" TIMESTAMPTZ(6),
    "payment_terms_days" INTEGER NOT NULL DEFAULT 30,
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" VARCHAR(1000),
    "taxable_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "tax_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "created_by_id" UUID NOT NULL,
    "issued_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_lines" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "requisition_id" UUID,
    "quantity" DECIMAL(18,4) NOT NULL,
    "rate" DECIMAL(18,4) NOT NULL,
    "tax_rate_percent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "taxable_amount" DECIMAL(18,2) NOT NULL,
    "tax_amount" DECIMAL(18,2) NOT NULL,
    "total_amount" DECIMAL(18,2) NOT NULL,
    "quantity_received" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "purchase_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receipts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "number" VARCHAR(32) NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "receipt_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vendor_document_number" VARCHAR(64),
    "received_by_id" UUID NOT NULL,
    "remarks" VARCHAR(1000),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "goods_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receipt_lines" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "goods_receipt_id" UUID NOT NULL,
    "purchase_order_line_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "vendor_batch_number" VARCHAR(64),
    "manufacturing_date" DATE,
    "expiry_date" DATE,
    "quantity_received" DECIMAL(18,4) NOT NULL,
    "quantity_rejected" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "storage_location" VARCHAR(128),
    "remarks" VARCHAR(1000),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "goods_receipt_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_lots" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "lot_number" VARCHAR(32) NOT NULL,
    "item_id" UUID NOT NULL,
    "goods_receipt_line_id" UUID NOT NULL,
    "vendor_batch_number" VARCHAR(64),
    "manufacturing_date" DATE,
    "expiry_date" DATE,
    "quantity_received" DECIMAL(18,4) NOT NULL,
    "quantity_available" DECIMAL(18,4) NOT NULL,
    "status" "StockLotStatus" NOT NULL DEFAULT 'QUARANTINE',
    "storage_location" VARCHAR(128),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "stock_lots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qc_results" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "stock_lot_id" UUID NOT NULL,
    "decision" "QcDecision" NOT NULL,
    "test_reference" VARCHAR(64),
    "remarks" VARCHAR(1000),
    "inspected_by_id" UUID NOT NULL,
    "inspected_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qc_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_ledger_entries" (
    "id" BIGSERIAL NOT NULL,
    "tenant_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "stock_lot_id" UUID,
    "entry_type" "StockLedgerEntryType" NOT NULL,
    "quantity_delta" DECIMAL(18,4) NOT NULL,
    "affects_usable_stock" BOOLEAN NOT NULL DEFAULT false,
    "reference" VARCHAR(64),
    "notes" VARCHAR(500),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_invoices" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "number" VARCHAR(32) NOT NULL,
    "vendor_invoice_number" VARCHAR(64) NOT NULL,
    "vendor_id" UUID NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "goods_receipt_id" UUID NOT NULL,
    "tolerance_exceeded" BOOLEAN NOT NULL DEFAULT false,
    "match_notes" VARCHAR(2000),
    "invoice_date" TIMESTAMPTZ(6) NOT NULL,
    "due_date" TIMESTAMPTZ(6) NOT NULL,
    "payment_terms_days" INTEGER NOT NULL DEFAULT 30,
    "taxable_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "tax_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "status" "PurchaseInvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" VARCHAR(1000),
    "recorded_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "purchase_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_invoice_lines" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "purchase_invoice_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "rate" DECIMAL(18,4) NOT NULL,
    "tax_rate_percent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "taxable_amount" DECIMAL(18,2) NOT NULL,
    "tax_amount" DECIMAL(18,2) NOT NULL,
    "total_amount" DECIMAL(18,2) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_payments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "number" VARCHAR(32) NOT NULL,
    "purchase_invoice_id" UUID NOT NULL,
    "payment_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "amount" DECIMAL(18,2) NOT NULL,
    "reference" VARCHAR(64),
    "method" VARCHAR(32),
    "notes" VARCHAR(500),
    "recorded_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "vendor_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_plans" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "number" VARCHAR(32) NOT NULL,
    "finished_product_id" UUID NOT NULL,
    "pack_variant" VARCHAR(128),
    "bom_id" UUID,
    "planned_quantity" DECIMAL(18,4) NOT NULL,
    "planned_date" DATE,
    "status" "ProductionPlanStatus" NOT NULL DEFAULT 'PLANNED',
    "notes" VARCHAR(1000),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "production_plans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "parties_tenant_id_party_type_deleted_at_idx" ON "parties"("tenant_id", "party_type", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "parties_tenant_id_code_key" ON "parties"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "document_sequences_tenant_id_doc_type_year_key" ON "document_sequences"("tenant_id", "doc_type", "year");

-- CreateIndex
CREATE INDEX "purchase_requisitions_tenant_id_status_deleted_at_idx" ON "purchase_requisitions"("tenant_id", "status", "deleted_at");

-- CreateIndex
CREATE INDEX "purchase_requisitions_tenant_id_item_id_idx" ON "purchase_requisitions"("tenant_id", "item_id");

-- CreateIndex
CREATE INDEX "purchase_requisitions_tenant_id_trigger_type_status_idx" ON "purchase_requisitions"("tenant_id", "trigger_type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_requisitions_tenant_id_number_key" ON "purchase_requisitions"("tenant_id", "number");

-- CreateIndex
CREATE INDEX "purchase_orders_tenant_id_status_deleted_at_idx" ON "purchase_orders"("tenant_id", "status", "deleted_at");

-- CreateIndex
CREATE INDEX "purchase_orders_tenant_id_vendor_id_idx" ON "purchase_orders"("tenant_id", "vendor_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_tenant_id_number_key" ON "purchase_orders"("tenant_id", "number");

-- CreateIndex
CREATE INDEX "purchase_order_lines_tenant_id_purchase_order_id_idx" ON "purchase_order_lines"("tenant_id", "purchase_order_id");

-- CreateIndex
CREATE INDEX "purchase_order_lines_tenant_id_item_id_idx" ON "purchase_order_lines"("tenant_id", "item_id");

-- CreateIndex
CREATE INDEX "goods_receipts_tenant_id_purchase_order_id_idx" ON "goods_receipts"("tenant_id", "purchase_order_id");

-- CreateIndex
CREATE INDEX "goods_receipts_tenant_id_receipt_date_idx" ON "goods_receipts"("tenant_id", "receipt_date");

-- CreateIndex
CREATE UNIQUE INDEX "goods_receipts_tenant_id_number_key" ON "goods_receipts"("tenant_id", "number");

-- CreateIndex
CREATE INDEX "goods_receipt_lines_tenant_id_goods_receipt_id_idx" ON "goods_receipt_lines"("tenant_id", "goods_receipt_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_lots_goods_receipt_line_id_key" ON "stock_lots"("goods_receipt_line_id");

-- CreateIndex
CREATE INDEX "stock_lots_tenant_id_item_id_status_expiry_date_idx" ON "stock_lots"("tenant_id", "item_id", "status", "expiry_date");

-- CreateIndex
CREATE UNIQUE INDEX "stock_lots_tenant_id_lot_number_key" ON "stock_lots"("tenant_id", "lot_number");

-- CreateIndex
CREATE INDEX "qc_results_tenant_id_stock_lot_id_created_at_idx" ON "qc_results"("tenant_id", "stock_lot_id", "created_at");

-- CreateIndex
CREATE INDEX "stock_ledger_entries_tenant_id_item_id_created_at_idx" ON "stock_ledger_entries"("tenant_id", "item_id", "created_at");

-- CreateIndex
CREATE INDEX "stock_ledger_entries_tenant_id_stock_lot_id_created_at_idx" ON "stock_ledger_entries"("tenant_id", "stock_lot_id", "created_at");

-- CreateIndex
CREATE INDEX "purchase_invoices_tenant_id_status_deleted_at_idx" ON "purchase_invoices"("tenant_id", "status", "deleted_at");

-- CreateIndex
CREATE INDEX "purchase_invoices_tenant_id_due_date_idx" ON "purchase_invoices"("tenant_id", "due_date");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_invoices_tenant_id_number_key" ON "purchase_invoices"("tenant_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_invoices_tenant_id_vendor_id_vendor_invoice_number_key" ON "purchase_invoices"("tenant_id", "vendor_id", "vendor_invoice_number");

-- CreateIndex
CREATE INDEX "purchase_invoice_lines_tenant_id_purchase_invoice_id_idx" ON "purchase_invoice_lines"("tenant_id", "purchase_invoice_id");

-- CreateIndex
CREATE INDEX "vendor_payments_tenant_id_purchase_invoice_id_idx" ON "vendor_payments"("tenant_id", "purchase_invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_payments_tenant_id_number_key" ON "vendor_payments"("tenant_id", "number");

-- CreateIndex
CREATE INDEX "production_plans_tenant_id_status_deleted_at_idx" ON "production_plans"("tenant_id", "status", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "production_plans_tenant_id_number_key" ON "production_plans"("tenant_id", "number");

-- AddForeignKey
ALTER TABLE "parties" ADD CONSTRAINT "parties_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_sequences" ADD CONSTRAINT "document_sequences_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requisitions" ADD CONSTRAINT "purchase_requisitions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requisitions" ADD CONSTRAINT "purchase_requisitions_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requisitions" ADD CONSTRAINT "purchase_requisitions_preferred_vendor_id_fkey" FOREIGN KEY ("preferred_vendor_id") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requisitions" ADD CONSTRAINT "purchase_requisitions_production_plan_id_fkey" FOREIGN KEY ("production_plan_id") REFERENCES "production_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_requisition_id_fkey" FOREIGN KEY ("requisition_id") REFERENCES "purchase_requisitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_goods_receipt_id_fkey" FOREIGN KEY ("goods_receipt_id") REFERENCES "goods_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_purchase_order_line_id_fkey" FOREIGN KEY ("purchase_order_line_id") REFERENCES "purchase_order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_goods_receipt_line_id_fkey" FOREIGN KEY ("goods_receipt_line_id") REFERENCES "goods_receipt_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_results" ADD CONSTRAINT "qc_results_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_results" ADD CONSTRAINT "qc_results_stock_lot_id_fkey" FOREIGN KEY ("stock_lot_id") REFERENCES "stock_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_ledger_entries" ADD CONSTRAINT "stock_ledger_entries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_ledger_entries" ADD CONSTRAINT "stock_ledger_entries_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_ledger_entries" ADD CONSTRAINT "stock_ledger_entries_stock_lot_id_fkey" FOREIGN KEY ("stock_lot_id") REFERENCES "stock_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_goods_receipt_id_fkey" FOREIGN KEY ("goods_receipt_id") REFERENCES "goods_receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoice_lines" ADD CONSTRAINT "purchase_invoice_lines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoice_lines" ADD CONSTRAINT "purchase_invoice_lines_purchase_invoice_id_fkey" FOREIGN KEY ("purchase_invoice_id") REFERENCES "purchase_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoice_lines" ADD CONSTRAINT "purchase_invoice_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_payments" ADD CONSTRAINT "vendor_payments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_payments" ADD CONSTRAINT "vendor_payments_purchase_invoice_id_fkey" FOREIGN KEY ("purchase_invoice_id") REFERENCES "purchase_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_plans" ADD CONSTRAINT "production_plans_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_plans" ADD CONSTRAINT "production_plans_finished_product_id_fkey" FOREIGN KEY ("finished_product_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_plans" ADD CONSTRAINT "production_plans_bom_id_fkey" FOREIGN KEY ("bom_id") REFERENCES "boms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- =============================================================================
-- Row-Level Security, compliance guards and privileges
-- =============================================================================
-- Everything below is hand-written: Prisma's schema language cannot express
-- policies, triggers or grants, and its differ cannot see them either. The
-- tables created above carry tenant_id and are worthless without this section.
--
-- items, boms and bom_lines are deliberately absent from every list here —
-- they already have their policies and triggers from the master-data
-- migrations, and re-creating a policy that exists is an error.

-- -----------------------------------------------------------------------------
-- 1. Tenant isolation
-- -----------------------------------------------------------------------------
-- Applied in a loop rather than fourteen copy-pasted blocks. The policy text is
-- identical for every one of these tables, and a loop cannot contain the
-- transcription error that a fifteenth hand-written copy eventually would.

DO $rls$
DECLARE
  v_table text;
  v_tables text[] := ARRAY[
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
    'vendor_payments',
    'production_plans'
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
-- 2. Append-only records
-- -----------------------------------------------------------------------------
-- A ledger or a quality decision whose rows can be edited afterwards is not
-- evidence of anything. Corrections are new rows, which is also how they become
-- visible. The privilege revoke below means the guarantee does not rest on the
-- trigger alone.

CREATE TRIGGER "stock_ledger_entries_append_only"
  BEFORE UPDATE OR DELETE ON "stock_ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION public.enforce_append_only();

CREATE TRIGGER "qc_results_append_only"
  BEFORE UPDATE OR DELETE ON "qc_results"
  FOR EACH ROW EXECUTE FUNCTION public.enforce_append_only();

-- -----------------------------------------------------------------------------
-- 3. No hard deletes on compliance-relevant documents
-- -----------------------------------------------------------------------------
-- These carry deleted_at, so the soft delete is the only route. Line tables are
-- absent on purpose: they cascade from their parent and have no independent
-- existence, so blocking DELETE would block editing a draft order's lines.
--
-- stock_lots has no deleted_at and no trigger either: a received batch is never
-- removed, it changes status. A REJECTED lot stays in the table for good, which
-- is the whole point of rejecting it traceably.

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

CREATE TRIGGER "parties_no_hard_delete"
  BEFORE DELETE ON "parties"
  FOR EACH ROW EXECUTE FUNCTION public.prevent_hard_delete();

CREATE TRIGGER "production_plans_no_hard_delete"
  BEFORE DELETE ON "production_plans"
  FOR EACH ROW EXECUTE FUNCTION public.prevent_hard_delete();

-- -----------------------------------------------------------------------------
-- 4. Privileges for the runtime role
-- -----------------------------------------------------------------------------
-- A no-op when pharma_app does not exist, which is the case on a managed
-- database where scripts/render-bootstrap.sql runs after the migrations. That
-- script re-applies the same restrictions after its blanket grant — see its
-- section 3a, which exists precisely because this block is skipped there.

DO $grants$
DECLARE
  v_role text := 'pharma_app';
  v_table text;
  v_rw text[] := ARRAY[
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
    'vendor_payments',
    'production_plans'
  ];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
    RAISE NOTICE 'Role % not present; skipping runtime grants.', v_role;
    RETURN;
  END IF;

  FOREACH v_table IN ARRAY v_rw LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE %I TO %I', v_table, v_role);
  END LOOP;

  -- Line tables need DELETE so a draft document's lines can be replaced.
  EXECUTE format('GRANT DELETE ON TABLE "purchase_order_lines" TO %I', v_role);
  EXECUTE format('GRANT DELETE ON TABLE "purchase_invoice_lines" TO %I', v_role);
  EXECUTE format('GRANT DELETE ON TABLE "goods_receipt_lines" TO %I', v_role);

  -- Append-only pair: insert and read, never update or delete.
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
-- A tenant-scoped table without RLS is a cross-tenant leak that no application
-- test would catch, because the application filters by tenant too. This check
-- fails the migration instead.

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
