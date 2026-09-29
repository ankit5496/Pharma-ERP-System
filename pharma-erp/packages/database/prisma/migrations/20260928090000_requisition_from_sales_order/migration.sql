-- Which demand a purchase requisition serves.
--
-- Material requirements now come from the sales order: the finished product
-- ordered, its formulation, and the shortfall between what that needs and what
-- is free. The document that goes to a vendor has to be able to name the order
-- it was raised for, or the trail stops at "somebody bought 60 kg".
--
-- BOTH NULLABLE. A requisition raised by hand for a material that serves no
-- single order answers neither, and every requisition already in the table was
-- raised before this existed.

ALTER TABLE "purchase_requisitions"
  ADD COLUMN "sales_order_id"      UUID,
  ADD COLUMN "sales_order_item_id" UUID;

ALTER TABLE "purchase_requisitions"
  ADD CONSTRAINT "purchase_requisitions_sales_order_id_fkey"
    FOREIGN KEY ("sales_order_id") REFERENCES "sales_orders"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "purchase_requisitions_sales_order_item_id_fkey"
    FOREIGN KEY ("sales_order_item_id") REFERENCES "sales_order_items"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- The duplicate guard reads by (sales order line, item): one requisition per
-- shortage, however many times the Required stock tab is opened.
CREATE INDEX "purchase_requisitions_tenant_sales_order_item_item_idx"
  ON "purchase_requisitions" ("tenant_id", "sales_order_item_id", "item_id");

-- ---------------------------------------------------------------------------
-- The reorder level a shortage used to be measured against.
--
-- NOT DROPPED. Requisitions raised under the old rule still carry the figure
-- that justified them — "raised when stock was 20 against a level of 50" — and
-- dropping the column would rewrite their reason. Made nullable instead, so a
-- sales-order-driven requisition can leave it empty rather than storing a zero
-- that reads as a real threshold.
-- ---------------------------------------------------------------------------

ALTER TABLE "purchase_requisitions"
  ALTER COLUMN "reorder_level_at_request" DROP NOT NULL;
