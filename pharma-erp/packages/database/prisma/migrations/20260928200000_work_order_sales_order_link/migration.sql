-- =============================================================================
-- US-PROD-01: the Sales Order a work order is made for
-- =============================================================================
-- The revised story: "Work Order is linked to the Sales Order that caused it
-- and cannot be created independently of one, under this MVP's order-driven
-- scope."
--
-- NULLABLE, though the story says mandatory. Three kinds of work order exist
-- and only one of them has a customer behind it:
--
--   * own-brand made against a confirmed order — the case the story describes
--   * JOB WORK, where the counterparty is a PRINCIPAL, not a customer. There
--     is no sales order and never will be; the order lives on
--     `job_work_order_id` in the column above.
--   * every work order raised before this migration, which predates the link
--     entirely.
--
-- A NOT NULL column would refuse all three of the last two. The "cannot be
-- created independently" rule therefore lives in the service, where it can ask
-- WHICH KIND of order this is, rather than in a constraint that cannot.
--
-- RESTRICT on delete, matching `product` and `bom` on the same table: a sales
-- order that something was manufactured against is not removable while the
-- batch record still cites it. Sales orders are cancelled rather than deleted,
-- so this is a backstop rather than a rule anybody meets.
-- =============================================================================

ALTER TABLE "production_orders"
  ADD COLUMN "sales_order_id" UUID;

ALTER TABLE "production_orders"
  ADD CONSTRAINT "production_orders_sales_order_id_fkey"
  FOREIGN KEY ("sales_order_id") REFERENCES "sales_orders" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The question asked of it: what is being made for this order? Asked from the
-- sales order's own screen, so it is worth an index rather than a scan of
-- every work order ever raised.
CREATE INDEX "production_orders_tenant_id_sales_order_id_idx"
  ON "production_orders" ("tenant_id", "sales_order_id");

-- A work order is for a CUSTOMER or for a PRINCIPAL, never both. The two
-- columns describe different counterparties and a row carrying each would be
-- claiming the same batch was made under two different commercial
-- arrangements — which decides who owns the material and who is billed.
ALTER TABLE "production_orders"
  ADD CONSTRAINT "production_orders_one_counterparty"
  CHECK ("sales_order_id" IS NULL OR "job_work_order_id" IS NULL);
