-- =============================================================================
-- US-PROD-05: the finished goods carry the order they were made for
-- =============================================================================
-- "The Finished-Goods Ledger entry is tagged Reserved to the Work Order's
-- originating Sales Order at the moment of creation."
--
-- COPIED FROM THE WORK ORDER AT RELEASE, not joined through it at read time. A
-- join would answer today's question — the batch's work order still names its
-- sales order — but this records what the stock was MADE FOR, and that has to
-- survive the work order being amended or its link being cleared. The same
-- reasoning already copies `expiry_date` onto this table rather than reading it
-- through the batch.
--
-- NULLABLE, because three kinds of batch reach here and only one has a customer
-- order behind it: order-driven own-brand production, job work for a principal,
-- and every lot released before this column existed. A NOT NULL column would
-- refuse the last two.
--
-- IT IS A TAG, NOT A HOLD, and the distinction matters. Allocation against a
-- sales order already lives in `batch_allocations`, which carries a quantity, a
-- despatch and a status, and is what decides who may ship what. This column
-- answers a different question — why was this batch made — and nothing reads it
-- to decide entitlement. Putting a second kind of claim on finished goods would
-- leave two tables disagreeing about the same stock.
-- =============================================================================

ALTER TABLE "finished_goods_lots"
  ADD COLUMN "sales_order_id" UUID;

ALTER TABLE "finished_goods_lots"
  ADD CONSTRAINT "finished_goods_lots_sales_order_id_fkey"
  FOREIGN KEY ("sales_order_id") REFERENCES "sales_orders" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- "What has been made for this order, and is any of it still on the shelf?"
CREATE INDEX "finished_goods_lots_tenant_id_sales_order_id_idx"
  ON "finished_goods_lots" ("tenant_id", "sales_order_id");
